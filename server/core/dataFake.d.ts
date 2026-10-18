// Types for dataFake.js (made-up answers of the data card sources).
import type { DataAnswer, DataRequest } from './dataCore';

export const FAKE_STOCKS_KEY: string;
export const FAKE_FX: Record<string, [number, string]>;
export function fakeDataCall(opts?: { now?: () => number; fail?: Record<string, number>; calls?: DataRequest[]; key?: string }): (req: DataRequest) => Promise<DataAnswer>;
