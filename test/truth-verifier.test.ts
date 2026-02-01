import * as assert from 'assert';
import * as path from 'path';
import {TruthVerifier, runOcr, looksLikeTrumpPost} from '../src/truth-verifier';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('TruthVerifier', function () {
  // OCR can be slow
  this.timeout(30000);

  let verifier: TruthVerifier;

  before(async () => {
    // Load verifier with test fixtures
    verifier = new TruthVerifier();
    await verifier.load();
  });

  describe('runOcr', () => {
    it('should extract text from real-truth.jpg', async () => {
      const imagePath = path.join(FIXTURES_DIR, 'real-truth.jpg');
      const text = await runOcr(imagePath);
      assert.ok(text.length > 0, 'OCR should return some text');
    });

    it('should extract text from fake-truth.jpg', async () => {
      const imagePath = path.join(FIXTURES_DIR, 'fake-truth.jpg');
      const text = await runOcr(imagePath);
      assert.ok(text.length > 0, 'OCR should return some text');
    });
  });

  describe('looksLikeTrumpPost', () => {
    it('should detect @realDonaldTrump', () => {
      assert.ok(looksLikeTrumpPost('Some text @realDonaldTrump more text'));
    });
  });

  describe('findMatch', () => {
    it('should verify real-truth.jpg as a real Trump post', async () => {
      const imagePath = path.join(FIXTURES_DIR, 'real-truth.jpg');
      const ocrText = await runOcr(imagePath);

      assert.ok(
        looksLikeTrumpPost(ocrText),
        'OCR text should look like a Trump post',
      );

      const result = verifier.findMatch(ocrText);
      assert.ok(
        result.verified,
        `Should verify as real, got similarity: ${result.similarity}`,
      );
      assert.ok(result.post, 'Should have a matching post');
      assert.ok(
        result.similarity >= 0.7,
        `Similarity should be >= 0.7, got: ${result.similarity}`,
      );
    });

    it('should NOT verify fake-truth.jpg as a real Trump post', async () => {
      const imagePath = path.join(FIXTURES_DIR, 'fake-truth.jpg');
      const ocrText = await runOcr(imagePath);

      const result = verifier.findMatch(ocrText);
      assert.ok(
        !result.verified,
        `Should NOT verify as real, got similarity: ${result.similarity}`,
      );
    });
  });
});
