// src/rateTable.ts
var ALL_RATES = [{
	year: 2026,
	effectiveFrom: "2026-01-01",
	reviewedOn: "2026-11-09",
	paye: {
		"deductNapsaBeforePaye": false,
		"bands": [
			{
				"fromNgwee": 0,
				"toNgwee": 51e4,
				"rateBps": 0
			},
			{
				"fromNgwee": 51e4,
				"toNgwee": 71e4,
				"rateBps": 2e3
			},
			{
				"fromNgwee": 71e4,
				"toNgwee": 92e4,
				"rateBps": 3e3
			},
			{
				"fromNgwee": 92e4,
				"toNgwee": null,
				"rateBps": 3700
			}
		]
	},
	napsa: {
		"employeeBps": 500,
		"employerBps": 500,
		"ceilingNgwee": 3723600
	},
	nhima: {
		"employeeBps": 100,
		"employerBps": 100
	},
	sdl: { "employerBps": 50 },
	sources: [
		{
			"covers": "PAYE bands",
			"title": "PwC Worldwide Tax Summaries: Zambia, taxes on personal income (2026 charge year, reviewed 24 July 2026)",
			"url": "https://taxsummaries.pwc.com/zambia/individual/taxes-on-personal-income"
		},
		{
			"covers": "NAPSA ceiling",
			"title": "PaySpace: NAPSA contribution ceiling increase effective January 2026",
			"url": "https://support.payspace.com/portal/en/kb/articles/zambia-napsa-contribution-ceiling-increase-effective-january-2026"
		},
		{
			"covers": "PAYE charged on gross (NAPSA and NHIMA not deducted first)",
			"title": "ZamCalc, citing s.4 of the Income Tax (Amendment) Act No. 22 of 2024. Secondary source: confirm against the Act or with ZRA",
			"url": "https://zamcalc.com/calculators/paye"
		},
		{
			"covers": "NHIMA 1% of basic salary",
			"title": "ITWeb Africa: National Health Insurance Fund now enforced (SI No. 63 of 2019)",
			"url": "https://itweb.africa/content/DZQ587VP4W5qzXy2"
		},
		{
			"covers": "Skills Development Levy on gross emoluments",
			"title": "Skills Development Levy Act No. 46 of 2016",
			"url": "https://www.policyvault.africa/policy/the-skills-development-levy-act-2016/?version=0"
		}
	]
}].slice().sort((a, b) => a.year - b.year);
function availableYears() {
	return ALL_RATES.map((r) => r.year);
}
function latestYear() {
	const latest = ALL_RATES[ALL_RATES.length - 1];
	if (!latest) throw new Error("No rate files found in src/rates/");
	return latest.year;
}
function getRates(year) {
	const rates = ALL_RATES.find((r) => r.year === year);
	if (!rates) throw new RangeError(`No rates available for ${year}`);
	return rates;
}
// src/calculator.ts
var BPS_SCALE = 1e4;
/** K1 billion. Keeps ngwee × basis-point arithmetic inside the safe integer range. */
var MAX_NGWEE = 1e11;
/** Rounds a value scaled by BPS_SCALE to whole ngwee, half-up. Integer-only, so exact. */
function roundHalfUp(scaled) {
	const shifted = scaled + BPS_SCALE / 2;
	return (shifted - shifted % BPS_SCALE) / BPS_SCALE;
}
function percentOf(ngwee, bps) {
	return roundHalfUp(ngwee * bps);
}
function assertValidAmount(name, value) {
	if (!Number.isInteger(value) || value < 0 || value > 1e11) throw new RangeError(`${name} must be a whole number of ngwee from 0 to ${MAX_NGWEE}`);
}
/**
* Applies the bands exactly, then rounds the running total at each step. PAYE is
* therefore the exact tax rounded once, and the band amounts always add up to it.
*/
function applyBands(taxable, bands) {
	let exactRunningTotal = 0;
	let paye = 0;
	const payeByBand = bands.map((band) => {
		const top = band.toNgwee ?? Number.POSITIVE_INFINITY;
		const amountNgwee = Math.max(0, Math.min(taxable, top) - band.fromNgwee);
		exactRunningTotal += amountNgwee * band.rateBps;
		const roundedRunningTotal = roundHalfUp(exactRunningTotal);
		const taxNgwee = roundedRunningTotal - paye;
		paye = roundedRunningTotal;
		return {
			...band,
			amountNgwee,
			taxNgwee
		};
	});
	return {
		paye,
		payeByBand
	};
}
function calculateWithRates({ basic, allowances }, rates) {
	assertValidAmount("basic", basic);
	assertValidAmount("allowances", allowances);
	const gross = basic + allowances;
	const napsaBase = Math.min(gross, rates.napsa.ceilingNgwee);
	const napsa = percentOf(napsaBase, rates.napsa.employeeBps);
	const nhima = percentOf(basic, rates.nhima.employeeBps);
	const taxable = rates.paye.deductNapsaBeforePaye ? gross - napsa : gross;
	const { paye, payeByBand } = applyBands(taxable, rates.paye.bands);
	const employerNapsa = percentOf(napsaBase, rates.napsa.employerBps);
	const employerNhima = percentOf(basic, rates.nhima.employerBps);
	const sdl = percentOf(gross, rates.sdl.employerBps);
	return {
		year: rates.year,
		gross,
		taxable,
		paye,
		payeByBand,
		napsa,
		nhima,
		net: gross - paye - napsa - nhima,
		employerCost: {
			napsa: employerNapsa,
			nhima: employerNhima,
			sdl,
			total: gross + employerNapsa + employerNhima + sdl
		}
	};
}
function calculate(input) {
	return calculateWithRates(input, getRates(input.year));
}
// src/compare.ts
function compareOffers(offers, year) {
	const results = offers.map((offer) => calculate({
		...offer,
		year
	}));
	const first = results[0];
	if (!first) return [];
	const topNet = Math.max(...results.map((r) => r.net));
	const allTied = results.every((r) => r.net === topNet);
	return results.map((result) => ({
		result,
		netDifference: result.net - first.net,
		isBest: !allTied && result.net === topNet
	}));
}
// src/money.ts
var MONEY_PATTERN = /^(?:K|ZMW)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{0,2}))?$/i;
var NEGATIVE_PATTERN = /^-\s*(?:K|ZMW)?\s*[\d.,]+$|^(?:K|ZMW)\s*-\s*[\d.,]+$/i;
/** Parses typed money such as "12,500", "K8000" or "1234.5" without using floats. */
function parseMoney(text) {
	const trimmed = text.trim();
	if (trimmed === "") return {
		ok: false,
		error: "blank"
	};
	if (NEGATIVE_PATTERN.test(trimmed)) return {
		ok: false,
		error: "negative"
	};
	const match = MONEY_PATTERN.exec(trimmed);
	if (!match) return {
		ok: false,
		error: "invalid"
	};
	const whole = (match[1] ?? "").replaceAll(",", "").replace(/^0+(?=\d)/, "");
	if (whole.length > 10) return {
		ok: false,
		error: "too-large"
	};
	const fraction = (match[2] ?? "").padEnd(2, "0");
	const ngwee = Number(whole) * 100 + Number(fraction);
	if (ngwee > 1e11) return {
		ok: false,
		error: "too-large"
	};
	return {
		ok: true,
		ngwee
	};
}
// src/reverse.ts
/**
* Rounding can lower net by a couple of ngwee over very small rises, so the binary
* search may land just above the true answer. This many ngwee back is always enough
* while combined marginal deductions stay below 90%.
*/
var SCAN_BACK_NGWEE = 32;
/** Finds the smallest basic salary that gives the target take-home pay. */
function requiredPayWithRates({ targetNet, allowances }, rates) {
	if (!Number.isInteger(targetNet) || targetNet < 0) throw new RangeError("targetNet must be a whole number of ngwee, zero or more");
	const payFor = (basic) => calculateWithRates({
		basic,
		allowances
	}, rates);
	const atZero = payFor(0);
	if (atZero.net > targetNet) return {
		status: "allowances-exceed-target",
		basic: 0,
		result: atZero
	};
	if (atZero.net === targetNet) return {
		status: "ok",
		basic: 0,
		result: atZero
	};
	if (payFor(1e11).net < targetNet) return { status: "out-of-range" };
	let tooLow = 0;
	let enough = MAX_NGWEE;
	while (enough - tooLow > 1) {
		const middle = tooLow + Math.floor((enough - tooLow) / 2);
		if (payFor(middle).net >= targetNet) enough = middle;
		else tooLow = middle;
	}
	for (let basic = Math.max(1, enough - SCAN_BACK_NGWEE); basic < enough; basic++) if (payFor(basic).net >= targetNet) {
		enough = basic;
		break;
	}
	return {
		status: "ok",
		basic: enough,
		result: payFor(enough)
	};
}
function requiredPay(input) {
	return requiredPayWithRates(input, getRates(input.year));
}
// server/app.ts
var MAX_OFFERS = 10;
var DOCS_URL = "https://github.com/moxes-x/zm-paye#api";
var ApiError = class extends Error {
	status;
	code;
	field;
	constructor(status, code, message, field) {
		super(message);
		this.status = status;
		this.code = code;
		this.field = field;
	}
};
var CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type"
};
function json(body, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: {
			...CORS_HEADERS,
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": status === 200 ? "public, max-age=3600" : "no-store",
			...extraHeaders
		}
	});
}
/** Formats ngwee as a plain decimal string: 586250 -> "5862.50". */
function kwacha(ngwee) {
	const sign = ngwee < 0 ? "-" : "";
	const absolute = Math.abs(ngwee);
	return `${sign}${(absolute - absolute % 100) / 100}.${String(absolute % 100).padStart(2, "0")}`;
}
var AMOUNT_ERRORS = {
	negative: "must be zero or more",
	invalid: "must be an amount such as 6500 or 6500.50",
	"too-large": "must be at most 1000000000"
};
function readAmount(value, field) {
	if (value === void 0 || value === null || value === "") return void 0;
	if (typeof value !== "string" && typeof value !== "number") throw new ApiError(400, "invalid-amount", `${field} ${AMOUNT_ERRORS.invalid}`, field);
	const parsed = parseMoney(String(value));
	if (parsed.ok) return parsed.ngwee;
	if (parsed.error === "blank") return void 0;
	throw new ApiError(400, "invalid-amount", `${field} ${AMOUNT_ERRORS[parsed.error]}`, field);
}
function readYear(value) {
	if (value === void 0 || value === null || value === "") return latestYear();
	const year = Number(value);
	if (!Number.isInteger(year) || !availableYears().includes(year)) throw new ApiError(400, "unknown-year", `year must be one of ${availableYears().join(", ")}`, "year");
	return year;
}
/**
* Accepts gross alone, gross with basic (allowances are the rest), or basic with
* optional allowances. Field names are prefixed for errors inside a compare body.
*/
function readPay(get, prefix = "") {
	const name = (field) => `${prefix}${field}`;
	const gross = readAmount(get("gross"), name("gross"));
	const basic = readAmount(get("basic"), name("basic"));
	const allowances = readAmount(get("allowances"), name("allowances"));
	if (gross !== void 0) {
		if (allowances !== void 0) throw new ApiError(400, "conflicting-fields", `Send ${name("gross")} (with ${name("basic")} if known), or ${name("basic")} and ${name("allowances")}, not both styles`, name("allowances"));
		if (basic === void 0) return {
			basic: gross,
			allowances: 0,
			assumedAllBasic: true
		};
		if (basic > gross) throw new ApiError(400, "basic-exceeds-gross", `${name("basic")} cannot be more than ${name("gross")}`, name("basic"));
		return {
			basic,
			allowances: gross - basic,
			assumedAllBasic: false
		};
	}
	if (basic === void 0) throw new ApiError(400, "missing-field", `Send ${name("gross")}, or ${name("basic")} with optional ${name("allowances")}`, name("gross"));
	return {
		basic,
		allowances: allowances ?? 0,
		assumedAllBasic: false
	};
}
var ALL_BASIC_NOTE = "Only gross was given, so NHIMA is 1% of the whole gross. NHIMA is charged on basic salary only; send basic for an exact figure.";
function amounts(result, factor = 1) {
	return {
		gross: kwacha(result.gross * factor),
		paye: kwacha(result.paye * factor),
		napsa: kwacha(result.napsa * factor),
		nhima: kwacha(result.nhima * factor),
		net: kwacha(result.net * factor)
	};
}
function inputSummary(pay) {
	return {
		basic: kwacha(pay.basic),
		allowances: kwacha(pay.allowances),
		nhimaAssumesAllBasic: pay.assumedAllBasic
	};
}
function takeHomeBody(result, pay) {
	return {
		year: result.year,
		input: inputSummary(pay),
		monthly: amounts(result),
		annual: amounts(result, 12),
		payeBands: result.payeByBand.map((band) => ({
			from: kwacha(band.fromNgwee),
			to: band.toNgwee === null ? null : kwacha(band.toNgwee),
			ratePercent: band.rateBps / 100,
			taxable: kwacha(band.amountNgwee),
			tax: kwacha(band.taxNgwee)
		})),
		employerCost: {
			napsa: kwacha(result.employerCost.napsa),
			nhima: kwacha(result.employerCost.nhima),
			sdl: kwacha(result.employerCost.sdl),
			total: kwacha(result.employerCost.total)
		},
		notes: pay.assumedAllBasic ? [ALL_BASIC_NOTE] : []
	};
}
function takeHome(url) {
	const get = (name) => url.searchParams.get(name) ?? void 0;
	const year = readYear(get("year"));
	const pay = readPay(get);
	return json(takeHomeBody(calculate({
		basic: pay.basic,
		allowances: pay.allowances,
		year
	}), pay));
}
function requiredSalary(url) {
	const get = (name) => url.searchParams.get(name) ?? void 0;
	const year = readYear(get("year"));
	const targetNet = readAmount(get("net"), "net");
	if (targetNet === void 0) throw new ApiError(400, "missing-field", "Send net, the take-home pay wanted", "net");
	const allowances = readAmount(get("allowances"), "allowances") ?? 0;
	const solved = requiredPay({
		targetNet,
		allowances,
		year
	});
	if (solved.status === "out-of-range") throw new ApiError(422, "out-of-range", "That take-home needs a salary above the K1,000,000,000 limit", "net");
	return json({
		year,
		status: solved.status,
		basic: kwacha(solved.basic),
		allowances: kwacha(allowances),
		monthly: amounts(solved.result),
		notes: solved.status === "allowances-exceed-target" ? ["The allowances alone give more take-home than the target, so basic is 0."] : ["Allowances are held fixed and the rest is treated as basic salary."]
	});
}
async function compare(request) {
	let body;
	try {
		body = await request.json();
	} catch {
		throw new ApiError(400, "invalid-json", "Send a JSON body such as {\"offers\":[{\"gross\":\"12000\"},{\"gross\":\"14000\"}]}");
	}
	const data = body ?? {};
	const offers = data.offers;
	if (!Array.isArray(offers) || offers.length < 2 || offers.length > MAX_OFFERS) throw new ApiError(400, "invalid-offers", `offers must be a list of 2 to ${MAX_OFFERS} offers`, "offers");
	const year = readYear(data.year);
	const inputs = offers.map((offer, i) => {
		if (!offer || typeof offer !== "object") throw new ApiError(400, "invalid-offers", `offers[${i}] must be an object`, `offers[${i}]`);
		const fields = offer;
		return readPay((name) => fields[name], `offers[${i}].`);
	});
	const compared = compareOffers(inputs.map(({ basic, allowances }) => ({
		basic,
		allowances
	})), year);
	return json({
		year,
		offers: compared.map((c, i) => ({
			index: i,
			input: inputSummary(inputs[i]),
			monthly: amounts(c.result),
			netDifferenceFromFirst: kwacha(c.netDifference),
			isBest: c.isBest
		})),
		best: compared.flatMap((c, i) => c.isBest ? [i] : []),
		notes: inputs.some((p) => p.assumedAllBasic) ? [ALL_BASIC_NOTE] : []
	});
}
function index() {
	return json({
		name: "Zambia take-home pay API",
		version: "v1",
		docs: DOCS_URL,
		ratesYears: availableYears(),
		endpoints: {
			"GET /v1/take-home": "?gross=6500&basic=3250, or ?basic=3250&allowances=3250. Optional: year",
			"GET /v1/required-salary": "?net=8074. Optional: allowances, year",
			"POST /v1/compare": "{\"offers\":[{\"gross\":\"12000\"},{\"basic\":\"5000\",\"allowances\":\"5000\"}]}",
			"GET /v1/rates": "Years with rates",
			"GET /v1/rates/{year}": "Bands, contribution rates and sources for a year"
		},
		disclaimer: "Estimates, not tax advice. Check anything important with ZRA or your payroll office."
	});
}
function requireMethod(request, method) {
	if (request.method !== method) throw new ApiError(405, "method-not-allowed", `Use ${method} for this endpoint`);
}
/**
* vercel.json rewrites /v1/... to the function at /api with the original path in
* __route, so routing works whichever URL the platform hands the function.
*/
function routePath(url) {
	const path = (url.searchParams.get("__route") ?? url.pathname).replace(/\/+$/, "") || "/";
	return path === "/api" ? "/" : path;
}
async function route(request) {
	if (request.method === "OPTIONS") return new Response(null, {
		status: 204,
		headers: CORS_HEADERS
	});
	const url = new URL(request.url);
	const path = routePath(url);
	switch (path) {
		case "/":
		case "/v1":
			requireMethod(request, "GET");
			return index();
		case "/v1/take-home":
			requireMethod(request, "GET");
			return takeHome(url);
		case "/v1/required-salary":
			requireMethod(request, "GET");
			return requiredSalary(url);
		case "/v1/compare":
			requireMethod(request, "POST");
			return compare(request);
		case "/v1/rates":
			requireMethod(request, "GET");
			return json({
				years: availableYears(),
				latest: latestYear()
			});
	}
	const ratesMatch = /^\/v1\/rates\/(\d{4})$/.exec(path);
	if (ratesMatch) {
		requireMethod(request, "GET");
		const year = Number(ratesMatch[1]);
		if (!availableYears().includes(year)) throw new ApiError(404, "unknown-year", `No rates for ${year}`);
		return json(getRates(year));
	}
	throw new ApiError(404, "not-found", `No endpoint at ${path}. See ${DOCS_URL}`);
}
var app_default = { async fetch(request) {
	try {
		return await route(request);
	} catch (error) {
		if (error instanceof ApiError) {
			const headers = error.status === 405 ? { Allow: "GET, POST, OPTIONS" } : {};
			return json({ error: {
				code: error.code,
				message: error.message,
				field: error.field
			} }, error.status, headers);
		}
		return json({ error: {
			code: "internal",
			message: "Something went wrong"
		} }, 500);
	}
} };
export { app_default as default };
