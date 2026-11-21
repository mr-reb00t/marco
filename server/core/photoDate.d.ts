// Types for photoDate.js (the day a photo was taken: the server, the admin upload and Marco Cloud).
export declare const DATE_HEADER_BYTES: number;
export declare function validPhotoDay(v: unknown): string;
export declare function exifDateTaken(seg: Uint8Array): string;
export declare function jpegDateTaken(bytes: Uint8Array): string;
export declare function fileNameDate(name: string): string;
