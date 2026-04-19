import { describe, expect, test } from "bun:test";
import { mapExifToGrainFields } from "./exif";

describe("mapExifToGrainFields", () => {
  test("maps canonical EXIF fields to Grain format", () => {
    const mapped = mapExifToGrainFields({
      Make: "Apple",
      Model: "iPhone 16",
      LensMake: "Apple",
      LensModel: "iPhone 16 back dual wide camera 5.96mm f/1.6",
      ISO: 32,
      FNumber: 1.6,
      ExposureTime: 0.001028,
      FocalLengthIn35mmFormat: 72,
      DateTimeOriginal: "2026:04:17 14:39:15",
      Flash: "Flash did not fire, compulsory flash mode",
    });

    expect(mapped).toEqual({
      make: "Apple",
      model: "iPhone 16",
      lensMake: "Apple",
      lensModel: "iPhone 16 back dual wide camera 5.96mm f/1.6",
      iSO: 32000000,
      fNumber: 1600000,
      exposureTime: 1028,
      focalLengthIn35mmFormat: 72000000,
      dateTimeOriginal: "2026-04-17T14:39:15.000Z",
      flash: "Flash did not fire, compulsory flash mode",
    });
  });

  test("returns undefined when no relevant fields", () => {
    expect(mapExifToGrainFields({})).toBeUndefined();
  });
});
