export interface FsCandidate {
  home: string;
  away: string;
  ts_diff_sec: number;
}

export interface FailedSample {
  ts: number;
  sport_slug: string;
  query_home: string;
  query_away: string;
  starts_at: string;
  reason: "name_mismatch" | "time_window_miss";
  fs_candidates: FsCandidate[];
}

const CAP = 500;

export class SampleCollector {
  private buffers = new Map<string, FailedSample[]>();

  record(sample: FailedSample): void {
    try {
      let buf = this.buffers.get(sample.sport_slug);
      if (!buf) { buf = []; this.buffers.set(sample.sport_slug, buf); }
      buf.push(sample);
      if (buf.length > CAP) buf.shift();
    } catch (err) {
      console.warn("[sample-collector] record failed:", (err as Error)?.message);
    }
  }

  getSamples(sportSlug: string, reason: string | undefined, limit: number): FailedSample[] {
    const buf = this.buffers.get(sportSlug) ?? [];
    const filtered = reason ? buf.filter((s) => s.reason === reason) : buf;
    const clamped = Math.max(1, Math.min(CAP, Math.floor(Number.isFinite(limit) ? limit : 1)));
    return filtered.slice(-clamped).reverse();
  }

  /** Test-only helper. Not exposed in production paths. */
  clear(): void {
    this.buffers.clear();
  }
}

export const sampleCollector = new SampleCollector();
