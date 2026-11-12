import { calculate, type PayInput, type PayResult } from './calculator';

export interface ComparedOffer {
  result: PayResult;
  /** Take-home pay relative to the first offer, in ngwee. */
  netDifference: number;
  /** True for the highest take-home pay. False for every offer when all of them tie. */
  isBest: boolean;
}

export function compareOffers(offers: PayInput[], year: number): ComparedOffer[] {
  const results = offers.map((offer) => calculate({ ...offer, year }));
  const first = results[0];
  if (!first) return [];

  const topNet = Math.max(...results.map((r) => r.net));
  const allTied = results.every((r) => r.net === topNet);

  return results.map((result) => ({
    result,
    netDifference: result.net - first.net,
    isBest: !allTied && result.net === topNet,
  }));
}
