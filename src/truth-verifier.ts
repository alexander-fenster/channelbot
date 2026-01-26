import * as fs from 'fs';
import {execFile} from 'child_process';
import {promisify} from 'util';
import * as stringSimilarity from 'string-similarity';

const execFileAsync = promisify(execFile);

const TRUMP_JSON_PATH = '/tmp/trump/trump.json';
const SIMILARITY_THRESHOLD = 0.7;

interface TruthPost {
  id: string;
  created_at: string;
  content: string;
  url: string;
  media: string[];
  replies_count: number;
  reblogs_count: number;
  favourites_count: number;
}

interface IndexedPost {
  index: number;
  words: Set<string>;
  normalizedContent: string;
}

export interface VerificationResult {
  verified: boolean;
  post: TruthPost | null;
  similarity: number;
  ocrText: string;
}

// Common English stop words to filter out
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'can',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'where',
  'when',
  'why',
  'how',
  'all',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'not',
  'only',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'as',
  'if',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'under',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'any',
  'our',
  'out',
  'up',
  'down',
  'off',
  'over',
  'own',
  'about',
  'against',
  'because',
  'until',
  'while',
  'also',
  'even',
  'get',
  'got',
  'go',
  'going',
  'make',
  'made',
  'now',
  'well',
  'way',
  'back',
  'still',
  'since',
  'am',
  'my',
  'your',
  'his',
  'her',
  'its',
  'their',
  'me',
  'him',
  'us',
  'them',
]);

export class TruthVerifier {
  private posts: TruthPost[] = [];
  private indexedPosts: IndexedPost[] = [];
  private wordIndex: Map<string, number[]> = new Map();
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    const content = await fs.promises.readFile(TRUMP_JSON_PATH, 'utf-8');
    this.posts = JSON.parse(content) as TruthPost[];

    // Build index
    for (let i = 0; i < this.posts.length; i++) {
      const post = this.posts[i];
      const normalizedContent = this.normalizeText(post.content);
      const words = this.extractSignificantWords(normalizedContent);

      this.indexedPosts.push({
        index: i,
        words,
        normalizedContent,
      });

      // Build inverted index
      for (const word of words) {
        if (!this.wordIndex.has(word)) {
          this.wordIndex.set(word, []);
        }
        this.wordIndex.get(word)!.push(i);
      }
    }

    this.loaded = true;
    console.log(
      `TruthVerifier loaded ${this.posts.length} posts, ${this.wordIndex.size} unique words indexed`,
    );
  }

  /**
   * Normalize text for comparison:
   * - lowercase
   * - fix common OCR errors
   * - remove extra whitespace
   * - remove URLs
   */
  private normalizeText(text: string): string {
    return (
      text
        .toLowerCase()
        // Common OCR errors
        .replace(/\|/g, 'i')
        .replace(/0/g, 'o')
        .replace(/1/g, 'l')
        // Remove URLs
        .replace(/https?:\/\/[^\s]+/g, '')
        // Remove special characters but keep spaces
        .replace(/[^\w\s]/g, ' ')
        // Collapse whitespace
        .replace(/\s+/g, ' ')
        .trim()
    );
  }

  /**
   * Extract significant words (filter out stop words and short words)
   */
  private extractSignificantWords(normalizedText: string): Set<string> {
    const words = normalizedText.split(' ');
    const significant = new Set<string>();

    for (const word of words) {
      if (word.length >= 4 && !STOP_WORDS.has(word)) {
        significant.add(word);
      }
    }

    return significant;
  }

  /**
   * Find candidate posts that share significant words with the query
   */
  private findCandidates(queryWords: Set<string>): Map<number, number> {
    const candidateScores = new Map<number, number>();

    for (const word of queryWords) {
      const postIndices = this.wordIndex.get(word);
      if (postIndices) {
        for (const idx of postIndices) {
          candidateScores.set(idx, (candidateScores.get(idx) || 0) + 1);
        }
      }
    }

    return candidateScores;
  }

  /**
   * Find the best matching post for the given OCR text
   */
  findMatch(ocrText: string): VerificationResult {
    if (!this.loaded) {
      throw new Error('TruthVerifier not loaded. Call load() first.');
    }

    const normalizedOcr = this.normalizeText(ocrText);
    const ocrWords = this.extractSignificantWords(normalizedOcr);

    if (ocrWords.size === 0) {
      return {verified: false, post: null, similarity: 0, ocrText};
    }

    // Phase 1: Find candidates
    const candidateScores = this.findCandidates(ocrWords);

    // Sort by shared word count, take top 50 candidates
    const sortedCandidates = Array.from(candidateScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50);

    if (sortedCandidates.length === 0) {
      return {verified: false, post: null, similarity: 0, ocrText};
    }

    // Phase 2: Compute similarity on candidates
    let bestMatch: {index: number; similarity: number} | null = null;

    for (const [postIndex] of sortedCandidates) {
      const indexedPost = this.indexedPosts[postIndex];
      const similarity = stringSimilarity.compareTwoStrings(
        normalizedOcr,
        indexedPost.normalizedContent,
      );

      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = {index: postIndex, similarity};
      }
    }

    if (bestMatch && bestMatch.similarity >= SIMILARITY_THRESHOLD) {
      return {
        verified: true,
        post: this.posts[bestMatch.index],
        similarity: bestMatch.similarity,
        ocrText,
      };
    }

    return {
      verified: false,
      post: bestMatch ? this.posts[bestMatch.index] : null,
      similarity: bestMatch?.similarity || 0,
      ocrText,
    };
  }
}

/**
 * Run tesseract OCR on an image file
 */
export async function runOcr(imagePath: string): Promise<string> {
  const {stdout} = await execFileAsync('tesseract', [imagePath, 'stdout']);
  return stdout;
}

/**
 * Check if OCR text looks like a Trump Truth post
 */
export function looksLikeTrumpPost(text: string): boolean {
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes('@realdonaldtrump') ||
    lowerText.includes('donald j. trump') ||
    lowerText.includes('donald j trump')
  );
}

/**
 * Download a file from URL to a temporary path
 */
export async function downloadFile(
  url: string,
  destPath: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(destPath, buffer);
}

// Singleton instance
let verifierInstance: TruthVerifier | null = null;

export async function getTruthVerifier(): Promise<TruthVerifier> {
  if (!verifierInstance) {
    verifierInstance = new TruthVerifier();
    await verifierInstance.load();
  }
  return verifierInstance;
}
