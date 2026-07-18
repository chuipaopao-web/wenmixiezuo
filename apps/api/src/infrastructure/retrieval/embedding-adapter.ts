export interface EmbeddingAdapter {
  readonly modelSnapshotId: string;
  readonly dimension: number;
  readonly available: boolean;
  readonly degradationReason: string | null;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export class DeterministicEmbeddingAdapter implements EmbeddingAdapter {
  public readonly modelSnapshotId = 'deterministic-test-embedding-v1';
  public readonly available = true;
  public readonly degradationReason = null;
  public constructor(public readonly dimension = 32) {}

  public async embedDocuments(texts: string[]): Promise<number[][]> { return texts.map((text) => this.vector(text)); }
  public async embedQuery(text: string): Promise<number[]> { return this.vector(text); }

  private vector(text: string): number[] {
    const values = Array.from<number>({ length: this.dimension }).fill(0);
    const points = [...text.normalize('NFC')];
    for (let index = 0; index < points.length; index += 1) {
      const code = points[index]!.codePointAt(0)!;
      values[(code + index * 17) % this.dimension]! += 1;
      values[(code * 7 + index) % this.dimension]! += 0.5;
    }
    const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
    return values.map((value) => value / norm);
  }
}
