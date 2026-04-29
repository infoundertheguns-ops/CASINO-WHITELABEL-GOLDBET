import { describe, it, expect } from "vitest";
import {
  parseHomeContentStoragePath,
  collectReferencedFilenames,
} from "@/lib/admin/home-content-storage";

describe("parseHomeContentStoragePath", () => {
  it("extracts filename from public Supabase URL", () => {
    expect(
      parseHomeContentStoragePath(
        "https://xgnyqkmugnfzhdveeqom.supabase.co/storage/v1/object/public/home-content/1720451234-ab12cd.png"
      )
    ).toBe("1720451234-ab12cd.png");
  });

  it("extracts filename from relative storage path", () => {
    expect(
      parseHomeContentStoragePath("/storage/v1/object/public/home-content/banner.jpg")
    ).toBe("banner.jpg");
  });

  it("decodes URL-encoded filenames", () => {
    expect(
      parseHomeContentStoragePath(
        "https://x.supabase.co/storage/v1/object/public/home-content/Serie%20A.svg"
      )
    ).toBe("Serie A.svg");
  });

  it("strips query strings", () => {
    expect(
      parseHomeContentStoragePath(
        "https://x.supabase.co/storage/v1/object/public/home-content/asset.png?cache-bust=1"
      )
    ).toBe("asset.png");
  });

  it("strips fragments", () => {
    expect(
      parseHomeContentStoragePath(
        "https://x.supabase.co/storage/v1/object/public/home-content/asset.png#foo"
      )
    ).toBe("asset.png");
  });

  it("returns null for non-home-content URLs", () => {
    expect(parseHomeContentStoragePath("/midas-svg/flags/IT.svg")).toBeNull();
    expect(parseHomeContentStoragePath("https://cdn.external.com/foo.jpg")).toBeNull();
    expect(parseHomeContentStoragePath("https://x.supabase.co/storage/v1/object/public/other-bucket/x.png")).toBeNull();
  });

  it("handles null, undefined, non-string", () => {
    expect(parseHomeContentStoragePath(null)).toBeNull();
    expect(parseHomeContentStoragePath(undefined)).toBeNull();
    expect(parseHomeContentStoragePath("")).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseHomeContentStoragePath(123 as any)).toBeNull();
  });
});

describe("collectReferencedFilenames", () => {
  it("aggregates image_url + icon_url + flag_url across rows", () => {
    const rows = [
      {
        image_url: "https://x.supabase.co/storage/v1/object/public/home-content/hero.png",
        icon_url: null,
        flag_url: null,
      },
      {
        image_url: null,
        icon_url: "https://x.supabase.co/storage/v1/object/public/home-content/sport.svg",
        flag_url: "https://x.supabase.co/storage/v1/object/public/home-content/IT.svg",
      },
      {
        image_url: "/midas-svg/hero.png", // external path — ignored
        icon_url: "https://x.supabase.co/storage/v1/object/public/home-content/hero.png", // duplicate
        flag_url: null,
      },
    ];
    const set = collectReferencedFilenames(rows);
    expect(set.size).toBe(3); // hero.png, sport.svg, IT.svg
    expect(set.has("hero.png")).toBe(true);
    expect(set.has("sport.svg")).toBe(true);
    expect(set.has("IT.svg")).toBe(true);
  });

  it("returns empty Set for empty input", () => {
    expect(collectReferencedFilenames([]).size).toBe(0);
    expect(collectReferencedFilenames([{ image_url: null, icon_url: null, flag_url: null }]).size).toBe(0);
  });

  it("dedups when the same filename appears in multiple rows", () => {
    const rows = Array.from({ length: 5 }, () => ({
      image_url: "https://x.supabase.co/storage/v1/object/public/home-content/shared.png",
      icon_url: null,
      flag_url: null,
    }));
    expect(collectReferencedFilenames(rows).size).toBe(1);
  });
});
