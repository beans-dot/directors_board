import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { composePdf } from './composePdf.mjs';

async function blankPdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 300]);
  return pdf.save();
}

function ink(color) {
  return {
    status: 'active',
    type: 'ink',
    page: 1,
    color,
    inkPaths: [
      [
        [0.2, 0.2],
        [0.4, 0.5],
      ],
    ],
  };
}

function pdfText(bytes) {
  const raw = Buffer.from(bytes).toString('latin1');
  const parts = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const body = Buffer.from(match[1], 'latin1');
    try {
      parts.push(inflateSync(body).toString('latin1'));
    } catch {
      parts.push(match[1]);
    }
  }
  return parts.join('\n');
}

describe('composed pen color', () => {
  it('draws the screen color name instead of treating it as a hex code', async () => {
    const blank = await blankPdf();
    const red = await composePdf(blank, [ink('red')]);
    const redText = pdfText(red.bytes);
    assert.match(redText, /0\.87843\d* 0\.19215\d* 0\.19215\d* RG/);

    const blue = await composePdf(blank, [ink('blue')]);
    const blueText = pdfText(blue.bytes);
    assert.match(blueText, /0\.18431\d* 0\.43529\d* 0\.92941\d* RG/);

    const hex = await composePdf(blank, [ink('#e03131')]);
    assert.match(pdfText(hex.bytes), /0\.87843\d* 0\.19215\d* 0\.19215\d* RG/);
  });
});
