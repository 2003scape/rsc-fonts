import BDF from '@misterhat/bdf';
import { JagArchive } from '@2003scape/rsc-archiver';

// default fonts
const FONTS = [
    'h11p.jf',
    'h12b.jf',
    'h12p.jf',
    'h13b.jf',
    'h14b.jf',
    'h16b.jf',
    'h20b.jf',
    'h24b.jf'
];

const CHARSET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!"£$%^&*()' +
    "-_=+[{]};:'@#~,<.>/?\\| ";

const CHARACTER_WIDTH = new Int32Array(256);

for (let i = 0; i < 256; i++) {
    let index = 74;

    for (let j = 0; j < CHARSET.length; j++) {
        if (CHARSET.charCodeAt(j) === i) {
            index = j;
            break;
        }
    }

    CHARACTER_WIDTH[i] = index * 9;
}

function writePosition(buffer, bufferPosition, position) {
    buffer[bufferPosition] = Math.floor(position / (128 * 128));
    position -= buffer[bufferPosition] * 128;

    buffer[bufferPosition + 1] = Math.floor(position / 128);
    position -= buffer[bufferPosition + 1] * 128;

    buffer[bufferPosition + 2] = position;
}

class Font {
    constructor(fontName, fontData) {
        if (!fontData || !fontData.length) {
            throw new Error('font data not specified');
        }

        this.fontData = new Int8Array(fontData);

        const match = fontName.match(/.(\d{2})(\w{1})/);

        if (match && match.length) {
            this.name = fontName.split('.')[0];
            this.size = Number(match[1]);
            this.style = match[2] === 'b' ? 'Bold' : 'Normal';
        }
    }

    static fromBDF(bdf) {
        const glyphBuffers = [];
        const glyphOffsets = [];
        let glyphOffset = 0;

        for (let i = 0; i < CHARSET.length; i++) {
            const charCode = CHARSET.charCodeAt(i);
            const glyph = bdf.glyphs[charCode];

            if (!glyph) {
                throw new Error(
                    `missing glyph "${CHARSET[i]}" (code ${charCode})`
                );
            }

            const { width, height } = glyph.boundingBox;

            const glyphData = new Uint8Array(width * height);

            let fontPosition = 0;

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    glyphData[fontPosition++] = glyph.bitmap[y][x];
                }
            }

            glyphBuffers.push(glyphData);
            glyphOffsets.push(855 + glyphOffset);

            glyphOffset += width * height;
        }

        const header = new Uint8Array(855);
        const fontData = new Uint8Array(header.length + glyphOffset);

        for (let i = 0; i < CHARSET.length; i++) {
            const charCode = CHARSET.charCodeAt(i);
            const glyph = bdf.glyphs[charCode];
            const characterOffset = CHARACTER_WIDTH[charCode];

            writePosition(header, characterOffset, glyphOffsets[i]);

            const {
                deviceWidthX,
                boundingBox: { width, height, x, y }
            } = glyph;

            header[characterOffset + 3] = width;
            header[characterOffset + 4] = height;

            header[characterOffset + 5] = x;
            header[characterOffset + 6] = y + height;

            // TODO maybe option for additional kerning here
            header[characterOffset + 7] = deviceWidthX;

            fontData.set(glyphBuffers[i], glyphOffsets[i]);
        }

        fontData.set(header);

        const name = bdf.meta.name || 'h';
        const style = /bold/i.test(bdf.meta.properties.weightName) ? 'b' : 'p';

        return new Font(`${name[0]}${bdf.meta.size.points}${style}`, fontData);
    }

    getJF() {
        const name = this.name || 'h';
        const style = /bold/i.test(this.style) ? 'b' : 'p';

        return `${name[0]}${this.size}${style}.jf`;
    }

    getGlyph(character) {
        const charCode = character.charCodeAt(0);
        const characterOffset = CHARACTER_WIDTH[charCode];

        // baseline and kerning offsets
        const xOffset = this.fontData[characterOffset + 5];
        const yOffset = this.fontData[characterOffset + 6];

        const width = this.fontData[characterOffset + 3];
        let height = this.fontData[characterOffset + 4];

        // position of pixel data for the font (on/off)
        let fontPosition =
            this.fontData[characterOffset] * (128 * 128) +
            this.fontData[characterOffset + 1] * 128 +
            this.fontData[characterOffset + 2];

        const bitmap = [];
        let isEmpty = true;

        const bitLength = Math.ceil(width / 8) * 8;

        for (let y = 0; y < height; y++) {
            const row = [];

            for (let i = 0; i < bitLength; i++) {
                row.push(0);
            }

            for (let x = 0; x < width; x++) {
                if (this.fontData[fontPosition] !== 0) {
                    row[x] = 1;
                    isEmpty = false;
                } else {
                    row[x] = 0;
                }

                fontPosition++;
            }

            bitmap.push(row);
        }

        const boundingBox = {
            width: 0,
            height: 0,
            x: 0,
            y: 0
        };

        if (isEmpty) {
            bitmap.length = 0;
        } else {
            boundingBox.width = width;
            boundingBox.height = height;
            boundingBox.x = xOffset;
            boundingBox.y = yOffset - height;
        }

        const displayWidth = this.fontData[characterOffset + 7];

        return {
            name: `character_${charCode}`,
            code: charCode,
            char: character,
            // TODO this still is off for some characters after ttf conversion
            scalableWidthX: (displayWidth + 1) * 75,
            scalableWidthY: 0,
            deviceWidthX: displayWidth,
            deviceWidthY: 0,
            boundingBox,
            bitmap
        };
    }

    toBDF() {
        const bdf = new BDF();

        let maxWidth = 0;
        let maxHeight = 0;
        let minY = 0;

        for (const character of CHARSET) {
            const glyph = this.getGlyph(character);

            bdf.glyphs[glyph.code] = glyph;

            if (glyph.boundingBox.width > maxWidth) {
                maxWidth = glyph.boundingBox.width;
            }

            if (glyph.boundingBox.height > maxHeight) {
                maxHeight = glyph.boundingBox.height;
            }

            if (glyph.boundingBox.y < minY) {
                minY = glyph.boundingBox.y;
            }
        }

        bdf.meta = {
            version: '2.1',
            boundingBox: {
                width: maxWidth,
                height: maxHeight + -minY,
                x: 0,
                y: minY
            },
            name: `${this.name}`,
            size: {
                points: this.size,
                resolutionX: 75,
                resolutionY: 75
            },
            properties: {
                weightName: this.style,
                fontDescent: -minY
            }
        };

        return bdf;
    }
}

class Fonts {
    constructor(fonts) {
        this.fonts = fonts;
        this.archive = new JagArchive();
    }

    async init() {
        await this.archive.init();
    }

    loadArchive(buffer) {
        this.archive.readArchive(buffer);

        this.fonts = this.fonts.map(
            (font) => new Font(font, this.archive.getEntry(font))
        );
    }

    toArchive() {
        for (const font of this.fonts) {
            this.archive.putEntry(font.getJF(), font.fontData);
        }

        return this.archive.toArchive(false);
    }
}

Fonts.FONTS = FONTS;
Fonts.CHARSET = CHARSET;

export { Font, Fonts };
