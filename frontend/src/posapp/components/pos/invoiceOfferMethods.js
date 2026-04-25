import {
	appendDebugPrintParam,
	isDebugPrintEnabled,
	silentPrint,
	watchPrintWindow,
} from "../../plugins/print.js";
import { isOffline } from "../../../offline/index.js";
import { formatUtils } from "../../format.js";
/* global __, frappe, flt */

export default {
	scheduleOfferRefresh(changedRowIds = []) {
		if (this.isApplyingOffer) {
			return;
		}

		this._pendingOfferRowIds = this._pendingOfferRowIds || new Set();
		if (Array.isArray(changedRowIds)) {
			changedRowIds.forEach((rowId) => {
				if (rowId) {
					this._pendingOfferRowIds.add(rowId);
				}
			});
		}

		if (this._offerRefreshPending) {
			return;
		}

		this._offerRefreshPending = true;

		const schedule =
			typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
				? window.requestAnimationFrame.bind(window)
				: (cb) => setTimeout(cb, 16);

		this._offerRefreshHandle = schedule(() => {
			this._offerRefreshHandle = null;
			this._offerRefreshPending = false;

			if (this.isApplyingOffer) {
				return;
			}

			const pendingRows = this._pendingOfferRowIds ? Array.from(this._pendingOfferRowIds) : [];
			this._pendingOfferRowIds = new Set();
			const removedRows = this._pendingRemovedRowInfo || {};
			this._pendingRemovedRowInfo = {};

			this.handelOffers(pendingRows, removedRows);

			if (typeof this.$forceUpdate === "function") {
				this.$forceUpdate();
			}
		});
	},
	cancelScheduledOfferRefresh() {
		if (this._offerRefreshHandle != null) {
			if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
				window.cancelAnimationFrame(this._offerRefreshHandle);
			} else {
				clearTimeout(this._offerRefreshHandle);
			}
			this._offerRefreshHandle = null;
		}

		this._offerRefreshPending = false;
		this._pendingOfferRowIds = new Set();
		this._pendingRemovedRowInfo = {};
	},
	normalizeBrand(brand) {
		return (brand || "").trim().toLowerCase();
	},
	normalizeString(str) {
		return (str || "").trim().toLowerCase();
	},
	_resolveOfferQty(item) {
		if (!item) {
			return 0;
		}

		const parse = (value) => {
			const numeric = Number.parseFloat(value);
			return Number.isFinite(numeric) ? numeric : null;
		};

		const preferred = [item.stock_qty, item.base_qty, item.base_quantity, item.transfer_qty];

		for (const candidate of preferred) {
			const parsed = parse(candidate);
			if (parsed !== null && parsed !== 0) {
				return parsed;
			}
		}

		const qty = parse(item.qty);
		if (qty === null) {
			return 0;
		}

		const factors = [item.conversion_factor, item.uom_conversion_factor];
		for (const raw of factors) {
			const factor = parse(raw);
			if (factor !== null && factor !== 0 && factor !== 1) {
				return qty * factor;
			}
		}

		return qty;
	},
	async getItemBrand(item) {
		let brand = this.normalizeBrand(item.brand);
		if (brand) {
			item.brand = brand;
			return brand;
		}

		this.brand_cache = this.brand_cache || {};

		if (this.brand_cache[item.item_code]) {
			brand = this.brand_cache[item.item_code];
		} else {
			try {
				const { message } = await frappe.call({
					method: "posawesome.posawesome.api.items.get_item_brand",
					args: { item_code: item.item_code },
				});
				brand = this.normalizeBrand(message);
			} catch (error) {
				console.error("Failed to fetch item brand:", error);
				brand = "";
			}

			this.brand_cache[item.item_code] = brand;
		}

		item.brand = brand;
		return brand;
	},
	checkOfferIsAppley(item, offer) {
		let applied = false;
		const item_offers = JSON.parse(item.posa_offers);
		for (const row_id of item_offers) {
			const exist_offer = this.posa_offers.find((el) => row_id == el.row_id);
			if (exist_offer && exist_offer.offer_name == offer.name) {
				applied = true;
				break;
			}
		}
		return applied;
	},

	async handelOffers(changedRowIds = [], removedRows = {}) {
		try {
			const sourceOffers = Array.isArray(this.posOffers) ? this.posOffers : [];
			if (!sourceOffers.length) {
				this.updatePosOffers([]);
				this._cachedOfferResults = new Map();
				return;
			}

			const allItems = [...(this.items || []), ...(this.packed_items || [])];
			const itemMap = new Map();
			allItems.forEach((item) => {
				if (item && item.posa_row_id) {
					itemMap.set(item.posa_row_id, item);
				}
			});

			const changedSet = new Set((Array.isArray(changedRowIds) ? changedRowIds : []).filter(Boolean));
			const removedInfo = removedRows || {};

			this._cachedOfferResults =
				this._cachedOfferResults instanceof Map ? this._cachedOfferResults : new Map();
			const cache = this._cachedOfferResults;

			const offerNames = new Set(sourceOffers.map((offer) => offer.name));
			for (const cachedName of Array.from(cache.keys())) {
				if (!offerNames.has(cachedName)) {
					cache.delete(cachedName);
				}
			}

			const offersToRecompute =
				!changedSet.size && !Object.keys(removedInfo).length
					? sourceOffers
					: sourceOffers.filter((offer) =>
							this.isOfferAffected(offer, changedSet, itemMap, removedInfo),
						);

			let context = null;
			if (offersToRecompute.length) {
				context = await this.buildOfferEvaluationContext(allItems, offersToRecompute);
				context.itemMap = itemMap;
			} else {
				context = { itemMap };
			}

			for (const offer of offersToRecompute) {
				const evaluated = this.evaluateOffer(offer, context);
				if (evaluated) {
					cache.set(offer.name, evaluated);
				} else {
					cache.delete(offer.name);
				}
			}

			const offers = sourceOffers.map((offer) => cache.get(offer.name)).filter((entry) => !!entry);

			this.setItemGiveOffer(offers);
			this.updatePosOffers(offers);
		} catch (error) {
			console.error("Failed to process offers:", error);
		}
	},

	isOfferAffected(offer, changedSet, itemMap, removedInfo = {}) {
		if (!offer) {
			return false;
		}

		if (!changedSet || !changedSet.size) {
			return true;
		}

		const applyOn = offer.apply_on;
		const normalizedBrand = applyOn === "Brand" ? this.normalizeBrand(offer.brand) : null;

		for (const rowId of changedSet) {
			const item = itemMap.get(rowId);
			const fallback = removedInfo[rowId];
			const meta = item
				? {
						item_code: item.item_code,
						item_group: item.item_group,
						brand: this.normalizeBrand(
							item.brand || (this.brand_cache && this.brand_cache[item.item_code]) || "",
						),
						custom_la_famille: this.normalizeString(item.custom_la_famille || ""),
						custom_la_collection: this.normalizeString(item.custom_la_collection || ""),
						variant_of: this.normalizeString(item.variant_of || ""),
					}
				: fallback
					? {
							item_code: fallback.item_code,
							item_group: fallback.item_group,
							brand: this.normalizeBrand(
								fallback.brand ||
									(this.brand_cache && this.brand_cache[fallback.item_code]) ||
									"",
							),
							custom_la_famille: this.normalizeString(fallback.custom_la_famille || ""),
							custom_la_collection: this.normalizeString(fallback.custom_la_collection || ""),
							variant_of: this.normalizeString(fallback.variant_of || ""),
						}
					: null;

			if (!meta) {
				return true;
			}

			switch (applyOn) {
				case "Item Code":
					if (meta.item_code === offer.item) {
						return true;
					}
					break;
				case "Item Group":
					if (meta.item_group === offer.item_group) {
						return true;
					}
					break;
				case "Brand":
					if (!normalizedBrand) {
						return true;
					}
					if (!meta.brand) {
						return true;
					}
					if (meta.brand === normalizedBrand) {
						return true;
					}
					break;
				case "Family":
					if (!offer.apply_rule_on_family) {
						return true;
					}
					if (!meta.custom_la_famille) {
						return true;
					}
					if (meta.custom_la_famille === this.normalizeString(offer.apply_rule_on_family)) {
						return true;
					}
					break;
				case "Collection":
					if (!offer.apply_rule_on_collection) {
						return true;
					}
					if (!meta.custom_la_collection) {
						return true;
					}
					if (meta.custom_la_collection === this.normalizeString(offer.apply_rule_on_collection)) {
						return true;
					}
					break;
				case "Template":
					if (!offer.apply_rule_on_template) {
						return true;
					}
					if (!meta.variant_of) {
						return true;
					}
					if (meta.variant_of === this.normalizeString(offer.apply_rule_on_template)) {
						return true;
					}
					break;
				case "Transaction":
					return true;
				default:
					break;
			}
		}

		return false;
	},

	async buildOfferEvaluationContext(allItems, offers) {
		const context = {
			itemMap: new Map(),
			itemCodeBuckets: new Map(),
			itemGroupBuckets: new Map(),
			brandBuckets: new Map(),
			familyBuckets: new Map(),
			collectionBuckets: new Map(),
			templateBuckets: new Map(),
			transactionBucket: { items: [], qty: 0, amount: 0 },
		};

		const needItemCode = offers.some((offer) => offer.apply_on === "Item Code");
		const needGroup = offers.some((offer) => offer.apply_on === "Item Group");
		const needBrand = offers.some((offer) => offer.apply_on === "Brand");
		const needFamily = offers.some((offer) => offer.apply_on === "Family");
		const needCollection = offers.some((offer) => offer.apply_on === "Collection");
		const needTemplate = offers.some((offer) => offer.apply_on === "Template");
		const needTransaction = offers.some((offer) => offer.apply_on === "Transaction");

		const brandCandidates = [];

		(Array.isArray(allItems) ? allItems : []).forEach((item) => {
			if (!item) {
				return;
			}
			if (item.posa_row_id) {
				context.itemMap.set(item.posa_row_id, item);
			}

			const qty = this._resolveOfferQty(item);
			const rate = item.original_price_list_rate ?? item.price_list_rate ?? 0;
			const amount = qty * rate;

			if (needItemCode && !item.posa_is_offer && item.item_code) {
				let bucket = context.itemCodeBuckets.get(item.item_code);
				if (!bucket) {
					bucket = { items: [], qty: 0, amount: 0 };
					context.itemCodeBuckets.set(item.item_code, bucket);
				}
				bucket.items.push(item);
				bucket.qty += qty;
				bucket.amount += amount;
			}

			if (needGroup && !item.posa_is_offer && item.item_group) {
				const normalizedGroup = this.normalizeString(item.item_group);
				let bucket = context.itemGroupBuckets.get(normalizedGroup);
				if (!bucket) {
					bucket = { items: [], qty: 0, amount: 0 };
					context.itemGroupBuckets.set(normalizedGroup, bucket);
				}
				bucket.items.push(item);
				bucket.qty += qty;
				bucket.amount += amount;
			}

			if (needBrand && !item.posa_is_offer && item.item_code) {
				brandCandidates.push(item);
			}

			if (needFamily && !item.posa_is_offer && item.custom_la_famille) {
				const normalizedFamily = this.normalizeString(item.custom_la_famille);
				let bucket = context.familyBuckets.get(normalizedFamily);
				if (!bucket) {
					bucket = { items: [], qty: 0, amount: 0 };
					context.familyBuckets.set(normalizedFamily, bucket);
				}
				bucket.items.push(item);
				bucket.qty += qty;
				bucket.amount += amount;
			}

			if (needCollection && !item.posa_is_offer && item.custom_la_collection) {
				const normalizedCollection = this.normalizeString(item.custom_la_collection);
				let bucket = context.collectionBuckets.get(normalizedCollection);
				if (!bucket) {
					bucket = { items: [], qty: 0, amount: 0 };
					context.collectionBuckets.set(normalizedCollection, bucket);
				}
				bucket.items.push(item);
				bucket.qty += qty;
				bucket.amount += amount;
			}

			if (needTemplate && !item.posa_is_offer && item.variant_of) {
				const normalizedTemplate = this.normalizeString(item.variant_of);
				let bucket = context.templateBuckets.get(normalizedTemplate);
				if (!bucket) {
					bucket = { items: [], qty: 0, amount: 0 };
					context.templateBuckets.set(normalizedTemplate, bucket);
				}
				bucket.items.push(item);
				bucket.qty += qty;
				bucket.amount += amount;
			}

			if (needTransaction && !item.posa_is_offer && !item.posa_is_replace) {
				context.transactionBucket.items.push(item);
				context.transactionBucket.qty += qty;
				context.transactionBucket.amount += amount;
			}
		});

		if (needBrand) {
			for (const item of brandCandidates) {
				const brand = await this.getItemBrand(item);
				if (!brand) {
					continue;
				}
				let bucket = context.brandBuckets.get(brand);
				if (!bucket) {
					bucket = { items: [], qty: 0, amount: 0 };
					context.brandBuckets.set(brand, bucket);
				}
				bucket.items.push(item);
				const qty = this._resolveOfferQty(item);
				bucket.qty += qty;
				const rate = item.original_price_list_rate ?? item.price_list_rate ?? 0;
				bucket.amount += qty * rate;
			}
		}

		return context;
	},

	evaluateOffer(offer, context = {}) {
		if (!offer) {
			return null;
		}

		console.log("DEBUG: evaluateOffer called", {
			offer_name: offer.name,
			offer_apply_on: offer.apply_on,
			offer_discount_type: offer.discount_type,
			offer_buying_price: offer.buying_price
		});

		if (offer.apply_on === "Item Code") {
			return this.getItemOffer({ ...offer }, context);
		}
		if (offer.apply_on === "Item Group") {
			return this.getGroupOffer({ ...offer }, context);
		}
		if (offer.apply_on === "Brand") {
			return this.getBrandOffer({ ...offer }, context);
		}
		if (offer.apply_on === "Family") {
			return this.getFamilyOffer({ ...offer }, context);
		}
		if (offer.apply_on === "Collection") {
			return this.getCollectionOffer({ ...offer }, context);
		}
		if (offer.apply_on === "Template") {
			console.log("DEBUG: Calling getTemplateOffer for Template offer");
			return this.getTemplateOffer({ ...offer }, context);
		}
		if (offer.apply_on === "Transaction") {
			return this.getTransactionOffer({ ...offer }, context);
		}
		return null;
	},

	setItemGiveOffer(offers) {
		// Set item give offer for replace
		offers.forEach((offer) => {
			if (offer.apply_on == "Item Code" && offer.apply_type == "Item Code" && offer.replace_item) {
				offer.give_item = offer.item;
				offer.apply_item_code = offer.item;
			} else if (
				offer.apply_on == "Item Group" &&
				offer.apply_type == "Item Group" &&
				offer.replace_cheapest_item
			) {
				const offerItemCode = this.getCheapestItem(offer).item_code;
				offer.give_item = offerItemCode;
				offer.apply_item_code = offerItemCode;
			}
		});
	},

	getCheapestItem(offer) {
		let itemsRowID;
		if (typeof offer.items === "string") {
			itemsRowID = JSON.parse(offer.items);
		} else {
			itemsRowID = offer.items;
		}
		const itemsList = [];
		itemsRowID.forEach((row_id) => {
			itemsList.push(this.getItemFromRowID(row_id));
		});
		const result = itemsList.reduce(function (res, obj) {
			return !obj.posa_is_replace && !obj.posa_is_offer && obj.price_list_rate < res.price_list_rate
				? obj
				: res;
		});
		return result;
	},

	getItemFromRowID(row_id) {
		const combined = [...this.items, ...this.packed_items];
		return combined.find((el) => el.posa_row_id == row_id);
	},

	checkQtyAnountOffer(offer, qty, amount) {
		let min_qty = false;
		let max_qty = false;
		let min_amt = false;
		let max_amt = false;
		const applys = [];

		if (offer.min_qty || offer.min_qty == 0) {
			if (qty >= offer.min_qty) {
				min_qty = true;
			}
			applys.push(min_qty);
		}

		if (offer.max_qty > 0) {
			if (qty <= offer.max_qty) {
				max_qty = true;
			}
			applys.push(max_qty);
		}

		if (offer.min_amt > 0) {
			if (amount >= offer.min_amt) {
				min_amt = true;
			}
			applys.push(min_amt);
		}

		if (offer.max_amt > 0) {
			if (amount <= offer.max_amt) {
				max_amt = true;
			}
			applys.push(max_amt);
		}
		let apply = false;
		if (!applys.includes(false)) {
			apply = true;
		}
		const res = {
			apply: apply,
			conditions: { min_qty, max_qty, min_amt, max_amt },
		};
		return res;
	},

	checkOfferCoupon(offer) {
		if (offer.coupon_based) {
			const coupon = this.posa_coupons.find((el) => offer.name == el.pos_offer);
			if (coupon) {
				offer.coupon = coupon.coupon;
				return true;
			} else {
				return false;
			}
		} else {
			offer.coupon = null;
			return true;
		}
	},

	getItemOffer(offer, context = {}) {
		if (!offer || offer.apply_on !== "Item Code") {
			return null;
		}

		if (!this.checkOfferCoupon(offer)) {
			return null;
		}

		const bucket = context.itemCodeBuckets ? context.itemCodeBuckets.get(offer.item) : null;
		if (!bucket) {
			return null;
		}

		const items = [];
		let totalQty = 0;
		let totalAmount = 0;

		bucket.items.forEach((item) => {
			if (!item || item.posa_is_offer) {
				return;
			}
			// For Buying Price: only check eligibility here, actual price change happens in ApplyOnPrice
			if (offer.offer === "Item Price" && offer.discount_type === "Buying Price") {
				const item_buying_price = item.buying_price || item.purchase_price || item.cost_price || item.valuation_rate || item.actual_cost_rate || 0;
				if (!item_buying_price) {
					return;
				}
				// cache resolved buying price so ApplyOnPrice doesn't need to re-resolve
				item._resolved_buying_price = item_buying_price;
			} else if (
				offer.offer === "Item Price" &&
				item.posa_offer_applied &&
				!this.checkOfferIsAppley(item, offer)
			) {
				return;
			}
			const qty = this._resolveOfferQty(item);
			const rate = item.original_price_list_rate ?? item.price_list_rate ?? 0;
			totalQty += qty;
			totalAmount += qty * rate;
			items.push(item.posa_row_id);
		});

		if (!totalQty && !totalAmount) {
			return null;
		}

		const res = this.checkQtyAnountOffer(offer, totalQty, totalAmount);
		if (!res.apply) {
			return null;
		}

		offer.items = items;
		return offer;
	},

	getGroupOffer(offer, context = {}) {
		if (!offer || offer.apply_on !== "Item Group") {
			return null;
		}

		if (!this.checkOfferCoupon(offer)) {
			return null;
		}

		const normalizedGroup = this.normalizeString(offer.item_group);
		const bucket = context.itemGroupBuckets ? context.itemGroupBuckets.get(normalizedGroup) : null;
		if (!bucket) {
			return null;
		}

		const items = [];
		let totalQty = 0;
		let totalAmount = 0;

		bucket.items.forEach((item) => {
			if (!item || item.posa_is_offer) {
				return;
			}
			// For Buying Price: only check eligibility here, actual price change happens in ApplyOnPrice
			if (offer.offer === "Item Price" && offer.discount_type === "Buying Price") {
				const item_buying_price = item.buying_price || item.purchase_price || item.cost_price || item.valuation_rate || item.actual_cost_rate || 0;
				if (!item_buying_price) {
					return;
				}
				// cache resolved buying price so ApplyOnPrice doesn't need to re-resolve
				item._resolved_buying_price = item_buying_price;
			} else if (
				offer.offer === "Item Price" &&
				item.posa_offer_applied &&
				!this.checkOfferIsAppley(item, offer)
			) {
				return;
			}
			const qty = this._resolveOfferQty(item);
			const rate = item.original_price_list_rate ?? item.price_list_rate ?? 0;
			totalQty += qty;
			totalAmount += qty * rate;
			items.push(item.posa_row_id);
		});

		if (!totalQty && !totalAmount) {
			return null;
		}

		const res = this.checkQtyAnountOffer(offer, totalQty, totalAmount);
		if (!res.apply) {
			return null;
		}

		offer.items = items;
		return offer;
	},

	getBrandOffer(offer, context = {}) {
		if (!offer || offer.apply_on !== "Brand") {
			return null;
		}

		if (!this.checkOfferCoupon(offer)) {
			return null;
		}

		const normalizedBrand = this.normalizeBrand(offer.brand);
		if (!normalizedBrand) {
			return null;
		}

		const bucket = context.brandBuckets ? context.brandBuckets.get(normalizedBrand) : null;
		if (!bucket) {
			return null;
		}

		const items = [];
		let totalQty = 0;
		let totalAmount = 0;

		bucket.items.forEach((item) => {
			if (!item || item.posa_is_offer) {
				return;
			}
			// For Buying Price: only check eligibility here, actual price change happens in ApplyOnPrice
			if (offer.offer === "Item Price" && offer.discount_type === "Buying Price") {
				const item_buying_price = item.buying_price || item.purchase_price || item.cost_price || item.valuation_rate || item.actual_cost_rate || 0;
				if (!item_buying_price) {
					return;
				}
				// cache resolved buying price so ApplyOnPrice doesn't need to re-resolve
				item._resolved_buying_price = item_buying_price;
			} else if (
				offer.offer === "Item Price" &&
				item.posa_offer_applied &&
				!this.checkOfferIsAppley(item, offer)
			) {
				return;
			}
			const qty = this._resolveOfferQty(item);
			const rate = item.original_price_list_rate ?? item.price_list_rate ?? 0;
			totalQty += qty;
			totalAmount += qty * rate;
			items.push(item.posa_row_id);
		});

		if (!totalQty && !totalAmount) {
			return null;
		}

		const res = this.checkQtyAnountOffer(offer, totalQty, totalAmount);
		if (!res.apply) {
			return null;
		}

		offer.items = items;
		return offer;
	},

	getFamilyOffer(offer, context = {}) {
		if (!offer || offer.apply_on !== "Family") {
			return null;
		}

		if (!this.checkOfferCoupon(offer)) {
			return null;
		}

		const normalizedFamily = this.normalizeString(offer.apply_rule_on_family);
		if (!normalizedFamily) {
			return null;
		}

		const bucket = context.familyBuckets ? context.familyBuckets.get(normalizedFamily) : null;
		if (!bucket) {
			return null;
		}

		const items = [];
		let totalQty = 0;
		let totalAmount = 0;

		bucket.items.forEach((item) => {
			if (!item || item.posa_is_offer) {
				return;
			}
			// For Buying Price: only check eligibility here, actual price change happens in ApplyOnPrice
			if (offer.offer === "Item Price" && offer.discount_type === "Buying Price") {
				console.log("DEBUG: getFamilyOffer - Buying Price eligibility check", {
					item_code: item.item_code,
					valuation_rate: item.valuation_rate,
					item_buying_price: item.buying_price,
					item_purchase_price: item.purchase_price,
					item_cost_price: item.cost_price,
					item_actual_cost_rate: item.actual_cost_rate,
					last_purchase_rate: item.last_purchase_rate,
					all_item_fields: Object.keys(item),
					rate: item.rate,
					base_rate: item.base_rate,
					price_list_rate: item.price_list_rate,
					formatted_price: item.formatted_price,
					projected_qty: item.projected_qty
				});
				
				const item_buying_price = item.last_purchase_rate || item.valuation_rate || item.buying_price || item.purchase_price || item.cost_price || item.actual_cost_rate || item._temp_buying_price || 0;
				console.log("DEBUG: getFamilyOffer - resolved buying price", {
					resolved_buying_price: item_buying_price
				});
				
				if (!item_buying_price) {
					console.log("DEBUG: getFamilyOffer - no buying price found, skipping item");
					return;
				}
				// cache resolved buying price so ApplyOnPrice doesn't need to re-resolve
				item._resolved_buying_price = item_buying_price;
				console.log("DEBUG: getFamilyOffer - cached resolved price", item._resolved_buying_price);
			} else if (
				offer.offer === "Item Price" &&
				item.posa_offer_applied &&
				!this.checkOfferIsAppley(item, offer)
			) {
				return;
			}
			const qty = this._resolveOfferQty(item);
			const rate = item.original_price_list_rate ?? item.price_list_rate ?? 0;
			totalQty += qty;
			totalAmount += qty * rate;
			items.push(item.posa_row_id);
		});

		if (!totalQty && !totalAmount) {
			return null;
		}

		const res = this.checkQtyAnountOffer(offer, totalQty, totalAmount);
		if (!res.apply) {
			return null;
		}

		offer.items = items;
		return offer;
	},

	getCollectionOffer(offer, context = {}) {
		if (!offer || offer.apply_on !== "Collection") {
			return null;
		}

		if (!this.checkOfferCoupon(offer)) {
			return null;
		}

		const normalizedCollection = this.normalizeString(offer.apply_rule_on_collection);
		if (!normalizedCollection) {
			return null;
		}

		const bucket = context.collectionBuckets ? context.collectionBuckets.get(normalizedCollection) : null;
		if (!bucket) {
			return null;
		}

		const items = [];
		let totalQty = 0;
		let totalAmount = 0;

		bucket.items.forEach((item) => {
			if (!item || item.posa_is_offer) {
				return;
			}
			// For Buying Price: only check eligibility here, actual price change happens in ApplyOnPrice
			if (offer.offer === "Item Price" && offer.discount_type === "Buying Price") {
				console.log("DEBUG: getCollectionOffer - Buying Price eligibility check", {
					item_code: item.item_code,
					last_purchase_rate: item.last_purchase_rate,
					valuation_rate: item.valuation_rate
				});
				
				const item_buying_price = item.last_purchase_rate || item.valuation_rate || item.buying_price || item.purchase_price || item.cost_price || item.actual_cost_rate || item._temp_buying_price || 0;
				console.log("DEBUG: getCollectionOffer - resolved buying price", {
					resolved_buying_price: item_buying_price
				});
				
				if (!item_buying_price) {
					console.log("DEBUG: getCollectionOffer - no buying price found, skipping item");
					return;
				}
				// cache resolved buying price so ApplyOnPrice doesn't need to re-resolve
				item._resolved_buying_price = item_buying_price;
				console.log("DEBUG: getCollectionOffer - cached resolved price", item._resolved_buying_price);
			} else if (
				offer.offer === "Item Price" &&
				item.posa_offer_applied &&
				!this.checkOfferIsAppley(item, offer)
			) {
				return;
			}
			const qty = this._resolveOfferQty(item);
			const rate = item.original_price_list_rate ?? item.price_list_rate ?? 0;
			totalQty += qty;
			totalAmount += qty * rate;
			items.push(item.posa_row_id);
		});

		if (!totalQty && !totalAmount) {
			return null;
		}

		const res = this.checkQtyAnountOffer(offer, totalQty, totalAmount);
		if (!res.apply) {
			return null;
		}

		offer.items = items;
		return offer;
	},

	getTemplateOffer(offer, context = {}) {
		console.log("DEBUG: getTemplateOffer called", {
			offer_name: offer.name,
			offer_apply_on: offer.apply_on,
			offer_apply_rule_on_template: offer.apply_rule_on_template,
			normalizedTemplate: this.normalizeString(offer.apply_rule_on_template)
		});
		
		if (!offer || offer.apply_on !== "Template") {
			console.log("DEBUG: getTemplateOffer - offer is not Template or is null");
			return null;
		}

		if (!this.checkOfferCoupon(offer)) {
			console.log("DEBUG: getTemplateOffer - coupon check failed");
			return null;
		}

		const normalizedTemplate = this.normalizeString(offer.apply_rule_on_template);
		if (!normalizedTemplate) {
			console.log("DEBUG: getTemplateOffer - no template rule");
			return null;
		}

		console.log("DEBUG: getTemplateOffer - looking for bucket", {
			templateBucketsAvailable: !!context.templateBuckets,
			normalizedTemplate,
			availableBuckets: context.templateBuckets ? Array.from(context.templateBuckets.keys()) : []
		});

		const bucket = context.templateBuckets ? context.templateBuckets.get(normalizedTemplate) : null;
		if (!bucket) {
			console.log("DEBUG: getTemplateOffer - no bucket found for template", normalizedTemplate);
			return null;
		}

		console.log("DEBUG: getTemplateOffer - bucket found", {
			bucketItems: bucket.items.length,
			bucketQty: bucket.qty,
			bucketAmount: bucket.amount
		});

		const items = [];
		let totalQty = 0;
		let totalAmount = 0;

		bucket.items.forEach((item) => {
			if (!item || item.posa_is_offer) {
				return;
			}
			// For Buying Price: only check eligibility here, actual price change happens in ApplyOnPrice
			if (offer.offer === "Item Price" && offer.discount_type === "Buying Price") {
				console.log("DEBUG: getTemplateOffer - Buying Price eligibility check", {
					item_code: item.item_code,
					last_purchase_rate: item.last_purchase_rate,
					valuation_rate: item.valuation_rate
				});
				
				const item_buying_price = item.last_purchase_rate || item.valuation_rate || item.buying_price || item.purchase_price || item.cost_price || item.actual_cost_rate || item._temp_buying_price || 0;
				console.log("DEBUG: getTemplateOffer - resolved buying price", {
					resolved_buying_price: item_buying_price
				});
				
				if (!item_buying_price) {
					console.log("DEBUG: getTemplateOffer - no buying price found, skipping item");
					return;
				}
				// cache resolved buying price so ApplyOnPrice doesn't need to re-resolve
				item._resolved_buying_price = item_buying_price;
				console.log("DEBUG: getTemplateOffer - cached resolved price", item._resolved_buying_price);
			} else if (
				offer.offer === "Item Price" &&
				item.posa_offer_applied &&
				!this.checkOfferIsAppley(item, offer)
			) {
				return;
			}
			const qty = this._resolveOfferQty(item);
			const rate = item.original_price_list_rate ?? item.price_list_rate ?? 0;
			totalQty += qty;
			totalAmount += qty * rate;
			items.push(item.posa_row_id);
		});

		if (!totalQty && !totalAmount) {
			return null;
		}

		const res = this.checkQtyAnountOffer(offer, totalQty, totalAmount);
		if (!res.apply) {
			return null;
		}

		offer.items = items;
		return offer;
	},

	getTransactionOffer(offer, context = {}) {
		if (!offer || offer.apply_on !== "Transaction") {
			return null;
		}

		if (!this.checkOfferCoupon(offer)) {
			return null;
		}

		const bucket = context.transactionBucket || { items: [], qty: 0, amount: 0 };
		if (!bucket.items.length && !bucket.qty && !bucket.amount) {
			return null;
		}

		const res = this.checkQtyAnountOffer(offer, bucket.qty, bucket.amount);
		if (!res.apply) {
			return null;
		}

		offer.items = bucket.items.map((item) => item.posa_row_id);
		return offer;
	},

	updatePosOffers(offers) {
		this.eventBus.emit("update_pos_offers", offers);
	},

	async updateInvoiceOffers(offers) {
		this.posa_offers.forEach((invoiceOffer) => {
			const existOffer = offers.find((offer) => invoiceOffer.row_id == offer.row_id);
			if (!existOffer) {
				this.removeApplyOffer(invoiceOffer);
			}
		});
		for (const offer of offers) {
			const existOffer = this.posa_offers.find((invoiceOffer) => invoiceOffer.row_id == offer.row_id);
			if (existOffer) {
				existOffer.items = JSON.stringify(offer.items);
				if (
					existOffer.offer === "Give Product" &&
					existOffer.give_item &&
					existOffer.give_item != offer.give_item
				) {
					const combined = [...this.items, ...this.packed_items];
					const item_to_remove = combined.find(
						(item) => item.posa_row_id == existOffer.give_item_row_id,
					);

					const newItemOffer = await this.ApplyOnGiveProduct(offer);

					if (!newItemOffer) {
						offer.give_item = existOffer.give_item;
						offer.give_item_row_id = existOffer.give_item_row_id;
						continue;
					}

					if (!item_to_remove) {
						this.notifyOfferItemUnavailable(existOffer.give_item);
						continue;
					}

					let updated_item_offers = [];
					if (Array.isArray(offer.items)) {
						updated_item_offers = offer.items.filter(
							(row_id) => row_id != item_to_remove.posa_row_id,
						);
					} else if (typeof offer.items === "string") {
						try {
							const parsed = JSON.parse(offer.items);
							if (Array.isArray(parsed)) {
								updated_item_offers = parsed.filter(
									(row_id) => row_id != item_to_remove.posa_row_id,
								);
							}
						} catch (error) {
							console.warn("Failed to parse offer items for update", error);
						}
					}
					offer.items = updated_item_offers;

					const collection = this.items.includes(item_to_remove) ? this.items : this.packed_items;
					const idx = collection.findIndex((el) => el.posa_row_id == item_to_remove.posa_row_id);
					if (idx > -1) collection.splice(idx, 1);

					existOffer.give_item_row_id = null;
					existOffer.give_item = null;

					if (offer.replace_cheapest_item) {
						const cheapestItem = this.getCheapestItem(offer);
						if (!cheapestItem) {
							this.notifyOfferItemUnavailable(offer.give_item);
							continue;
						}
						const oldBaseItem = combined.find(
							(el) => el.posa_row_id == item_to_remove.posa_is_replace,
						);
						newItemOffer.qty = item_to_remove.qty;
						if (oldBaseItem && !oldBaseItem.posa_is_replace) {
							oldBaseItem.qty += item_to_remove.qty;
						} else {
							const qtyToRestore = item_to_remove.qty;
							const itemCodeToRestore = item_to_remove.item_code;
							this.$nextTick(async () => {
								const restoredItem = await this.ApplyOnGiveProduct(
									{
										given_qty: qtyToRestore,
									},
									itemCodeToRestore,
								);
								if (restoredItem) {
									restoredItem.posa_is_offer = 0;
									this.items.unshift(restoredItem);
								}
							});
						}
						newItemOffer.posa_is_offer = 0;
						newItemOffer.posa_is_replace = cheapestItem.posa_row_id;
						const diffQty = cheapestItem.qty - newItemOffer.qty;
						if (diffQty <= 0) {
							newItemOffer.qty += diffQty;
							const baseCollection = this.items.includes(cheapestItem)
								? this.items
								: this.packed_items;
							const baseIndex = baseCollection.findIndex(
								(el) => el.posa_row_id == cheapestItem.posa_row_id,
							);
							if (baseIndex > -1) baseCollection.splice(baseIndex, 1);
							newItemOffer.posa_row_id = cheapestItem.posa_row_id;
							newItemOffer.posa_is_replace = newItemOffer.posa_row_id;
						} else {
							cheapestItem.qty = diffQty;
						}
					}

					this.items.unshift(newItemOffer);
					existOffer.give_item_row_id = newItemOffer.posa_row_id;
					existOffer.give_item = newItemOffer.item_code;
				} else if (
					existOffer.offer === "Give Product" &&
					existOffer.give_item &&
					existOffer.give_item == offer.give_item &&
					(offer.replace_item || offer.replace_cheapest_item)
				) {
					this.$nextTick(async () => {
						const offerItem = this.getItemFromRowID(existOffer.give_item_row_id);
						if (!offerItem) {
							return;
						}

						const diff = offer.given_qty - (offerItem.qty || 0);
						if (diff <= 0) {
							return;
						}

						let itemsRowID = [];
						try {
							const parsed = JSON.parse(existOffer.items);
							if (Array.isArray(parsed)) {
								itemsRowID = parsed;
							}
						} catch (error) {
							console.warn("Failed to parse offer items", error);
							itemsRowID = [];
						}

						if (!itemsRowID.length) {
							return;
						}

						const itemsList = [];
						itemsRowID.forEach((row_id) => {
							const resolved = this.getItemFromRowID(row_id);
							if (resolved) {
								itemsList.push(resolved);
							}
						});

						const existItem = itemsList.find(
							(el) =>
								el &&
								el.item_code == offerItem.item_code &&
								el.posa_is_replace != offerItem.posa_row_id,
						);
						if (!existItem) {
							return;
						}

						const diffExistQty = existItem.qty - diff;
						if (diffExistQty > 0) {
							offerItem.qty += diff;
							existItem.qty -= diff;
						} else {
							offerItem.qty += existItem.qty;
							const col = this.items.includes(existItem) ? this.items : this.packed_items;
							const idx2 = col.findIndex((el) => el.posa_row_id == existItem.posa_row_id);
							if (idx2 > -1) col.splice(idx2, 1);
						}
					});
				} else if (existOffer.offer === "Item Price") {
					this.ApplyOnPrice(offer);
				} else if (existOffer.offer === "Grand Total") {
					this.ApplyOnTotal(offer);
				}
				this.addOfferToItems(existOffer);
			} else {
				await this.applyNewOffer(offer);
			}
		}
	},

	removeApplyOffer(invoiceOffer) {
		if (invoiceOffer.offer === "Item Price") {
			this.RemoveOnPrice(invoiceOffer);
			const index = this.posa_offers.findIndex((el) => el.row_id === invoiceOffer.row_id);
			this.posa_offers.splice(index, 1);
		}
		if (invoiceOffer.offer === "Give Product") {
			const combined = [...this.items, ...this.packed_items];
			const item_to_remove = combined.find((item) => item.posa_row_id == invoiceOffer.give_item_row_id);
			const index = this.posa_offers.findIndex((el) => el.row_id === invoiceOffer.row_id);
			this.posa_offers.splice(index, 1);
			if (item_to_remove) {
				const collection = this.items.includes(item_to_remove) ? this.items : this.packed_items;
				const idx = collection.findIndex((el) => el.posa_row_id == item_to_remove.posa_row_id);
				if (idx > -1) collection.splice(idx, 1);
			}
		}
		if (invoiceOffer.offer === "Grand Total") {
			this.RemoveOnTotal(invoiceOffer);
			const index = this.posa_offers.findIndex((el) => el.row_id === invoiceOffer.row_id);
			this.posa_offers.splice(index, 1);
		}
		if (invoiceOffer.offer === "Loyalty Point") {
			const index = this.posa_offers.findIndex((el) => el.row_id === invoiceOffer.row_id);
			this.posa_offers.splice(index, 1);
		}
		this.deleteOfferFromItems(invoiceOffer);
	},

	async applyNewOffer(offer) {
		this.isApplyingOffer = true;
		if (offer.offer === "Item Price") {
			this.ApplyOnPrice(offer);
		}
		if (offer.offer === "Give Product") {
			let itemsRowID = [];
			if (typeof offer.items === "string") {
				try {
					const parsed = JSON.parse(offer.items);
					if (Array.isArray(parsed)) {
						itemsRowID = parsed;
					}
				} catch (error) {
					console.warn("Failed to parse offer item rows", error);
				}
			} else if (Array.isArray(offer.items)) {
				itemsRowID = offer.items;
			}
			if (offer.apply_on == "Item Code" && offer.apply_type == "Item Code" && offer.replace_item) {
				const item = await this.ApplyOnGiveProduct(offer, offer.item);
				if (!item) {
					this.isApplyingOffer = false;
					return;
				}
				const replaceRowId = Array.isArray(itemsRowID) ? itemsRowID[0] : null;
				if (!replaceRowId) {
					this.isApplyingOffer = false;
					return;
				}
				item.posa_is_replace = replaceRowId;
				const combined = [...this.items, ...this.packed_items];
				const baseItem = combined.find((el) => el && el.posa_row_id == item.posa_is_replace);
				if (!baseItem) {
					this.isApplyingOffer = false;
					return;
				}
				const diffQty = baseItem.qty - offer.given_qty;
				item.posa_is_offer = 0;
				if (diffQty <= 0) {
					item.qty = baseItem.qty;
					const collection = this.items.includes(baseItem) ? this.items : this.packed_items;
					const idx = collection.findIndex((el) => el.posa_row_id == baseItem.posa_row_id);
					if (idx > -1) collection.splice(idx, 1);
					item.posa_row_id = item.posa_is_replace;
				} else {
					baseItem.qty = diffQty;
				}
				this.items.unshift(item);
				offer.give_item_row_id = item.posa_row_id;
			} else if (
				offer.apply_on == "Item Group" &&
				offer.apply_type == "Item Group" &&
				offer.replace_cheapest_item
			) {
				const itemsList = [];
				itemsRowID.forEach((row_id) => {
					const resolved = this.getItemFromRowID(row_id);
					if (resolved) {
						itemsList.push(resolved);
					}
				});
				const baseItem = itemsList.find((el) => el && el.item_code == offer.give_item);
				const item = await this.ApplyOnGiveProduct(offer, offer.give_item);
				if (!item || !baseItem) {
					this.isApplyingOffer = false;
					return;
				}
				item.posa_is_offer = 0;
				item.posa_is_replace = baseItem.posa_row_id;
				const diffQty = baseItem.qty - offer.given_qty;
				if (diffQty <= 0) {
					item.qty = baseItem.qty;
					const collection = this.items.includes(baseItem) ? this.items : this.packed_items;
					const idx = collection.findIndex((el) => el.posa_row_id == baseItem.posa_row_id);
					if (idx > -1) collection.splice(idx, 1);
					item.posa_row_id = item.posa_is_replace;
				} else {
					baseItem.qty = diffQty;
				}
				this.items.unshift(item);
				offer.give_item_row_id = item.posa_row_id;
			} else {
				const item = await this.ApplyOnGiveProduct(offer);
				if (item) {
					this.items.unshift(item);
					offer.give_item_row_id = item.posa_row_id;
				} else {
					this.isApplyingOffer = false;
					return;
				}
			}
		}
		if (offer.offer === "Grand Total") {
			this.ApplyOnTotal(offer);
		}
		if (offer.offer === "Loyalty Point") {
			this.eventBus.emit("show_message", {
				title: __("Loyalty Point Offer Applied"),
				color: "success",
			});
		}

		const newOffer = {
			offer_name: offer.name,
			row_id: offer.row_id,
			apply_on: offer.apply_on,
			offer: offer.offer,
			items: JSON.stringify(offer.items),
			give_item: offer.give_item,
			give_item_row_id: offer.give_item_row_id,
			offer_applied: offer.offer_applied,
			coupon_based: offer.coupon_based,
			coupon: offer.coupon,
		};
		this.posa_offers.push(newOffer);
		this.addOfferToItems(newOffer);
		this.isApplyingOffer = false;
	},

	notifyOfferItemUnavailable(itemCode = "") {
		const code = itemCode ? String(itemCode).trim() : "";
		const message = code
			? __("Unable to add offer item {0}. Please refresh and try again.", [code])
			: __("Unable to add offer item. Please refresh and try again.");

		if (this && this.eventBus && typeof this.eventBus.emit === "function") {
			this.eventBus.emit("show_message", {
				title: __("Offer item unavailable"),
				color: "error",
				message,
			});
		}

		console.warn("Offer item unavailable", { itemCode: code });
	},

	async resolveOfferItem(item_code) {
		const code = item_code ? String(item_code).trim() : "";
		if (!code) {
			return null;
		}

		const cachedItems = Array.isArray(this.allItems) ? this.allItems : [];
		let item = cachedItems.find((entry) => entry && entry.item_code == code);

		if (!item) {
			const combined = [...(this.items || []), ...(this.packed_items || [])];
			item = combined.find(
				(entry) => entry && entry.item_code == code && !entry.posa_is_offer && !entry.posa_is_replace,
			);
		}

		if (!item && this.pos_profile && this.pos_profile.name) {
			try {
				const args = {
					pos_profile: JSON.stringify(this.pos_profile),
					items_data: JSON.stringify([{ item_code: code }]),
				};
				const priceList =
					this.selected_price_list ||
					this.active_price_list ||
					(this.pos_profile && this.pos_profile.selling_price_list);
				if (priceList) {
					args.price_list = priceList;
				}
				const { message } = await frappe.call({
					method: "posawesome.posawesome.api.items.get_items_details",
					args,
				});
				const fetched = Array.isArray(message) ? message[0] : null;
				if (fetched && fetched.item_code) {
					item = fetched;
					if (!Array.isArray(this.allItems)) {
						this.allItems = [];
					}
					const exists = this.allItems.some(
						(entry) => entry && entry.item_code == fetched.item_code,
					);
					if (!exists) {
						this.allItems.push(fetched);
						if (this.eventBus && typeof this.eventBus.emit === "function") {
							this.eventBus.emit("set_all_items", this.allItems);
						}
					}
				}
			} catch (error) {
				console.error("Failed to fetch offer item details:", error);
			}
		}

		return item || null;
	},

	async ApplyOnGiveProduct(offer, item_code) {
		if (!item_code) {
			item_code = offer.give_item;
		}
		const item = await this.resolveOfferItem(item_code);
		if (!item) {
			this.notifyOfferItemUnavailable(item_code || (offer && offer.give_item));
			return null;
		}
		const new_item = { ...item };
		new_item.qty = offer.given_qty;
		new_item.stock_qty = offer.given_qty;

		// Handle rate based on currency
		if (offer.discount_type === "Rate") {
			// offer.rate is always in base currency (PKR)
			new_item.base_rate = offer.rate;
			const baseCurrency = this.price_list_currency || this.pos_profile.currency;
			if (this.selected_currency !== baseCurrency) {
				// If exchange rate is 300 PKR = 1 USD
				// Convert PKR to USD by multiplying
				new_item.rate = this.flt(offer.rate * this.exchange_rate, this.currency_precision);
			} else {
				new_item.rate = offer.rate;
			}
		} else if (offer.discount_type === "Discount Percentage") {
			// Apply percentage discount on item's base rate
			const base_price = item.base_rate || item.rate / this.exchange_rate;
			const base_discount = this.flt(
				(base_price * offer.discount_percentage) / 100,
				this.currency_precision,
			);
			new_item.base_discount_amount = base_discount;
			new_item.base_rate = this.flt(base_price - base_discount, this.currency_precision);

			const baseCurrency = this.price_list_currency || this.pos_profile.currency;
			if (this.selected_currency !== baseCurrency) {
				new_item.discount_amount = this.flt(
					base_discount * this.exchange_rate,
					this.currency_precision,
				);
				new_item.rate = this.flt(new_item.base_rate * this.exchange_rate, this.currency_precision);
			} else {
				new_item.discount_amount = base_discount;
				new_item.rate = new_item.base_rate;
			}
		} else if (offer.discount_type === "Buying Price") {
			// Calculate selling price based on buying price + offer buying_price
			console.log("DEBUG: Give Product Buying Price offer", {
				offer: offer,
				item: item,
				item_fields: Object.keys(item)
			});
			
			const base_price = item.base_rate || item.rate / this.exchange_rate;
			// Try different possible field names for buying price
			const item_buying_price = item.buying_price || item.purchase_price || item.cost_price || item.actual_cost_rate || 0; // Get item's buying price
			
			console.log("DEBUG: Give Product - Item buying price found", item_buying_price);
			
			if (!item_buying_price) {
				console.log("DEBUG: Give Product - No buying price found, using original rate");
				// If no buying price available, fallback to original rate
				const baseCurrency = this.price_list_currency || this.pos_profile.currency;
				if (this.selected_currency !== baseCurrency) {
					new_item.base_rate = base_price;
					new_item.rate = item.rate;
				} else {
					new_item.base_rate = base_price;
					new_item.rate = base_price;
				}
			} else {
				// Calculate new selling price: buying_price + offer.buying_price
				const new_selling_price_base = item_buying_price + (offer.buying_price || 0);
				const base_discount = base_price - new_selling_price_base;
				
				console.log("DEBUG: Give Product - Buying Price calculation", {
					base_price,
					item_buying_price,
					offer_buying_price: offer.buying_price,
					new_selling_price_base,
					base_discount
				});
				
				new_item.base_discount_amount = base_discount;
				new_item.base_rate = new_selling_price_base;

				const baseCurrency = this.price_list_currency || this.pos_profile.currency;
				if (this.selected_currency !== baseCurrency) {
					new_item.discount_amount = this.flt(
						base_discount * this.exchange_rate,
						this.currency_precision,
					);
					new_item.rate = this.flt(new_selling_price_base * this.exchange_rate, this.currency_precision);
				} else {
					new_item.discount_amount = base_discount;
					new_item.rate = new_selling_price_base;
				}
			}
		} else {
			// Use item's original rate
			const baseCurrency = this.price_list_currency || this.pos_profile.currency;
			if (this.selected_currency !== baseCurrency) {
				new_item.base_rate = item.base_rate || item.rate / this.exchange_rate;
				new_item.rate = item.rate;
			} else {
				new_item.base_rate = item.rate;
				new_item.rate = item.rate;
			}
		}

		// Handle discount amount based on currency
		if (offer.discount_type === "Discount Amount") {
			// offer.discount_amount is always in base currency (PKR)
			new_item.base_discount_amount = offer.discount_amount;
			const baseCurrency = this.price_list_currency || this.pos_profile.currency;
			if (this.selected_currency !== baseCurrency) {
				// Convert PKR to USD by multiplying
				new_item.discount_amount = this.flt(
					offer.discount_amount * this.exchange_rate,
					this.currency_precision,
				);
			} else {
				new_item.discount_amount = offer.discount_amount;
			}
		} else if (offer.discount_type !== "Discount Percentage") {
			new_item.base_discount_amount = 0;
			new_item.discount_amount = 0;
		}

		new_item.discount_percentage =
			offer.discount_type === "Discount Percentage" ? offer.discount_percentage : 0;
		new_item.discount_amount_per_item = 0;
		new_item.uom = item.uom ? item.uom : item.stock_uom;
		new_item.actual_batch_qty = "";
		new_item.conversion_factor = 1;
		new_item.posa_offers = JSON.stringify([]);
		new_item.posa_offer_applied =
			offer.discount_type === "Rate" ||
			offer.discount_type === "Discount Amount" ||
			offer.discount_type === "Discount Percentage" ||
			offer.discount_type === "Buying Price"
				? 1
				: 0;
		new_item.posa_is_offer = 1;
		new_item.posa_is_replace = null;
		new_item.posa_notes = "";
		new_item.posa_delivery_date = "";

		// Handle free items
		const is_free =
			(offer.discount_type === "Rate" && !offer.rate) ||
			(offer.discount_type === "Discount Percentage" && offer.discount_percentage == 100) ||
			(offer.discount_type === "Buying Price" && (!offer.buying_price || offer.buying_price == 0));

		new_item.is_free_item = is_free ? 1 : 0;

		// Set price list rate based on currency similar to invoice logic
		if (is_free) {
			new_item.base_price_list_rate = 0;
			new_item.price_list_rate = 0;
		} else {
			// Use the item's price list rate if available
			new_item.price_list_rate = item.price_list_rate ?? item.rate ?? 0;
			// Determine base price list rate just like invoice items
			const baseCurrency = this.price_list_currency || this.pos_profile.currency;
			if (this.selected_currency !== baseCurrency) {
				new_item.base_price_list_rate = this.flt(
					item.base_price_list_rate !== undefined
						? item.base_price_list_rate
						: item.rate / this.exchange_rate,
					this.currency_precision,
				);
			} else {
				new_item.base_price_list_rate =
					item.base_price_list_rate !== undefined ? item.base_price_list_rate : item.rate;
			}
		}

		new_item.posa_row_id = this.makeid(20);

		if ((!this.pos_profile.posa_auto_set_batch && new_item.has_batch_no) || new_item.has_serial_no) {
			// Store only the item's row ID for the expanded state
			this.expanded.push(new_item.posa_row_id);
		}

		this.update_item_detail(new_item);
		return new_item;
	},

	ApplyOnPrice(offer) {
		if (!offer) return;

		const combined = [...this.items, ...this.packed_items];
		combined.forEach((item) => {
			// Check if offer.items exists and is valid
			if (!item || !offer.items || !Array.isArray(offer.items)) return;

			if (offer.items.includes(item.posa_row_id)) {
				// Ensure posa_offers is initialized and valid
				const item_offers = item.posa_offers ? JSON.parse(item.posa_offers) : [];
				if (!Array.isArray(item_offers)) return;

				if (!item_offers.includes(offer.row_id)) {
					// Store original rates only if this is the first offer being applied
					if (!item.posa_offer_applied && !item.original_base_rate) {
						// Store original prices normalized to conversion factor 1
						const cf = flt(item.conversion_factor || 1);
						item.original_base_rate = item.base_rate / cf;
						item.original_base_price_list_rate = item.base_price_list_rate / cf;
						item.original_rate = item.rate / cf;
						item.original_price_list_rate = item.price_list_rate / cf;
						
						// FIX: always initialize cache and store
						if (item.item_code) {
							if (!this._itemBuyingPriceCache) this._itemBuyingPriceCache = {};
							if (!this._itemBuyingPriceCache[item.item_code]) {
								this._itemBuyingPriceCache[item.item_code] = {};
							}
							this._itemBuyingPriceCache[item.item_code].original_price_list_rate = 
								item.price_list_rate;
							// also store last_purchase_rate and variant_of if available
							if (item.last_purchase_rate) {
								this._itemBuyingPriceCache[item.item_code].last_purchase_rate = 
									item.last_purchase_rate;
							}
							if (item.variant_of) {
								this._itemBuyingPriceCache[item.item_code].variant_of = item.variant_of;
							}
						}
					}

					const conversion_factor = flt(item.conversion_factor || 1);

					if (offer.discount_type === "Rate") {
						// offer.rate is always in base currency (e.g. PKR)
						const base_offer_rate = flt(offer.rate * conversion_factor);

						// Determine original base price for reference
						const base_price = this.flt(
							(item.original_base_price_list_rate ??
								item.base_price_list_rate / conversion_factor) * conversion_factor,
							this.currency_precision,
						);

						// Set base rates and keep original price list rate
						item.base_rate = base_offer_rate;
						item.base_price_list_rate = base_price;

						// Convert to selected currency if needed
						const baseCurrency = this.price_list_currency || this.pos_profile.currency;
						if (this.selected_currency !== baseCurrency) {
							// If exchange rate is 285 PKR = 1 USD
							// To convert PKR to USD multiply by exchange rate
							item.rate = this.flt(
								base_offer_rate * this.exchange_rate,
								this.currency_precision,
							);
							item.price_list_rate = this.flt(
								base_price * this.exchange_rate,
								this.currency_precision,
							);
							item.discount_amount = this.flt(
								(base_price - base_offer_rate) * this.exchange_rate,
								this.currency_precision,
							);
						} else {
							item.rate = base_offer_rate;
							item.price_list_rate = base_price;
							item.discount_amount = this.flt(
								base_price - base_offer_rate,
								this.currency_precision,
							);
						}

						// Compute base discount amounts and percentage
						item.base_discount_amount = this.flt(
							base_price - base_offer_rate,
							this.currency_precision,
						);
						item.discount_percentage = base_price
							? this.flt(
									(item.base_discount_amount / base_price) * 100,
									this.currency_precision,
								)
							: 0;
					} else if (offer.discount_type === "Discount Percentage") {
						item.discount_percentage = offer.discount_percentage;

						// Calculate discount in base currency first
						// Use normalized price * current conversion factor
						const base_price = this.flt(
							(item.original_base_price_list_rate ??
								item.base_price_list_rate / conversion_factor) * conversion_factor,
							this.currency_precision,
						);
						const base_discount = this.flt(
							(base_price * offer.discount_percentage) / 100,
							this.currency_precision,
						);
						item.base_discount_amount = base_discount;
						item.base_rate = this.flt(base_price - base_discount, this.currency_precision);

						// Keep price list rate at original price
						item.base_price_list_rate = base_price;

						// Convert to selected currency if needed
						const baseCurrency = this.price_list_currency || this.pos_profile.currency;
						if (this.selected_currency !== baseCurrency) {
							item.rate = this.flt(
								item.base_rate * this.exchange_rate,
								this.currency_precision,
							);
							item.price_list_rate = this.flt(
								base_price * this.exchange_rate,
								this.currency_precision,
							);
							item.discount_amount = this.flt(
								base_discount * this.exchange_rate,
								this.currency_precision,
							);
						} else {
							item.rate = item.base_rate;
							item.price_list_rate = base_price;
							item.discount_amount = base_discount;
						}
					} else if (offer.discount_type === "Buying Price") {
						console.log("DEBUG: ApplyOnPrice - Buying Price section reached", {
							item_code: item.item_code,
							valuation_rate: item.valuation_rate,
							cached_buying_price: item._resolved_buying_price,
							item_buying_price: item.buying_price,
							last_purchase_rate: item.last_purchase_rate,
							offer_buying_price: offer.buying_price
						});
						
						// Apply buying price logic to existing item
						const item_buying_price = item._resolved_buying_price || item.last_purchase_rate || item.valuation_rate || item.buying_price || item.purchase_price || item.cost_price || item.actual_cost_rate || 0;
						
						console.log("DEBUG: ApplyOnPrice - resolved buying price", {
							resolved_buying_price: item_buying_price
						});
						
						if (!item_buying_price) {
							// If no buying price, skip offer
							console.log("DEBUG: ApplyOnPrice - no buying price, skipping offer");
							return;
						}
						
						const base_price = this.flt(
							(item.original_base_price_list_rate ??
								item.base_price_list_rate / conversion_factor) * conversion_factor,
							this.currency_precision,
						);
						const new_selling_price_base = item_buying_price + (offer.buying_price || 0);
						const base_discount = base_price - new_selling_price_base;
						
						item.base_discount_amount = base_discount;
						item.base_rate = new_selling_price_base;
						item.base_price_list_rate = base_price;

						// Convert to selected currency if needed
						const baseCurrency = this.price_list_currency || this.pos_profile.currency;
						if (this.selected_currency !== baseCurrency) {
							item.rate = this.flt(
								new_selling_price_base * this.exchange_rate,
								this.currency_precision,
							);
							item.price_list_rate = this.flt(
								base_price * this.exchange_rate,
								this.currency_precision,
							);
							item.discount_amount = this.flt(
								base_discount * this.exchange_rate,
								this.currency_precision,
							);
						} else {
							item.rate = new_selling_price_base;
							item.price_list_rate = base_price;
							item.discount_amount = base_discount;
						}
						// add this line:
						item.discount_percentage = base_price ? this.flt((base_discount / base_price) * 100, this.currency_precision) : 0;
					}

					// Calculate final amounts
					item.amount = this.flt(item.qty * item.rate, this.currency_precision);
					item.base_amount = this.flt(item.qty * item.base_rate, this.currency_precision);

					item.posa_offer_applied = 1;
					this.$forceUpdate();
				}
			}
		});
	},

	RemoveOnPrice(offer) {
		if (!offer) return;

		const combined = [...this.items, ...this.packed_items];
		combined.forEach((item) => {
			if (!item || !item.posa_offers) return;

			try {
				const item_offers = JSON.parse(item.posa_offers);
				if (!Array.isArray(item_offers)) return;

				if (item_offers.includes(offer.row_id)) {
					// Check if we have original rates stored
					if (!item.original_base_rate) {
						// Try to restore from buying price cache before giving up
						if (this._itemBuyingPriceCache && this._itemBuyingPriceCache[item.item_code]) {
							const cached = this._itemBuyingPriceCache[item.item_code];
							if (cached.last_purchase_rate) {
								item.last_purchase_rate = cached.last_purchase_rate;
							}
						}
						// If still no original rates, fetch and skip removal this cycle
						// Offer will re-evaluate after update_item_detail completes
						console.warn("Original rates not found, fetching from server");
						this.update_item_detail(item).then(() => {
							this.scheduleOfferRefresh();
						});
						return;
					}

					// Get current conversion factor
					const cf = flt(item.conversion_factor || 1);

					// Restore original rates adjusted for current conversion factor
					item.base_rate = this.flt(item.original_base_rate * cf, this.currency_precision);
					item.base_price_list_rate = this.flt(
						item.original_base_price_list_rate * cf,
						this.currency_precision,
					);

					// Convert to selected currency
					const baseCurrency = this.price_list_currency || this.pos_profile.currency;
					if (this.selected_currency !== baseCurrency) {
						item.rate = this.flt(item.base_rate * this.exchange_rate, this.currency_precision);
						item.price_list_rate = this.flt(
							item.base_price_list_rate * this.exchange_rate,
							this.currency_precision,
						);
					} else {
						item.rate = item.base_rate;
						item.price_list_rate = item.base_price_list_rate;
					}

					// Reset all discounts
					item.discount_percentage = 0;
					item.discount_amount = 0;
					item.base_discount_amount = 0;

					// Recalculate amounts
					item.amount = this.flt(item.qty * item.rate, this.currency_precision);
					item.base_amount = this.flt(item.qty * item.base_rate, this.currency_precision);

					// Only clear original rates if no other offers are applied
					const remaining_offers = item_offers.filter((id) => id !== offer.row_id);
					if (remaining_offers.length === 0) {
						item.original_base_rate = null;
						item.original_base_price_list_rate = null;
						item.original_rate = null;
						item.original_price_list_rate = null;
						item.posa_offer_applied = 0;
					}

					// Update posa_offers
					item.posa_offers = JSON.stringify(remaining_offers);

					// Force UI update
					this.$forceUpdate();
				}
			} catch (error) {
				console.error("Error removing price offer:", error);
				this.eventBus.emit("show_message", {
					title: __("Error removing price offer"),
					color: "error",
					message: error.message,
				});
			}
		});
	},

	ApplyOnTotal(offer) {
		if (!offer.name) {
			offer = this.posOffers.find((el) => el.name == offer.offer_name);
		}
		if (this.discount_percentage_offer_name === offer.name && this.discount_amount !== 0) {
			// Discount already applied, do not recalculate when items change
			return;
		}
		if (
			(!this.discount_percentage_offer_name || this.discount_percentage_offer_name == offer.name) &&
			offer.discount_percentage > 0 &&
			offer.discount_percentage <= 100
		) {
			this.discount_amount = this.flt(
				(flt(this.Total) * flt(offer.discount_percentage)) / 100,
				this.currency_precision,
			);
			this.discount_percentage_offer_name = offer.name;

			// Update invoice level discount fields so the value
			// is reflected in the UI and saved correctly
			this.additional_discount = this.discount_amount;
			if (this.Total && this.Total !== 0) {
				const baseTotal = this.isReturnInvoice ? Math.abs(this.Total) : this.Total;

				let computedPercentage = (this.discount_amount / baseTotal) * 100;

				if (this.isReturnInvoice) {
					computedPercentage = -Math.abs(computedPercentage);
				}

				this.additional_discount_percentage = computedPercentage;
			} else {
				this.additional_discount_percentage = 0;
			}
		}
	},

	RemoveOnTotal(offer) {
		if (this.discount_percentage_offer_name && this.discount_percentage_offer_name == offer.offer_name) {
			this.discount_amount = 0;
			this.discount_percentage_offer_name = null;

			// Reset invoice discount fields when offer is removed
			this.additional_discount = 0;
			this.additional_discount_percentage = 0;
		}
	},

	addOfferToItems(offer) {
		if (!offer || !offer.items) return;

		try {
			const offer_items = typeof offer.items === "string" ? JSON.parse(offer.items) : offer.items;
			if (!Array.isArray(offer_items)) return;

			const combined = [...this.items, ...this.packed_items];
			offer_items.forEach((el) => {
				combined.forEach((exist_item) => {
					if (!exist_item || !exist_item.posa_row_id) return;

					if (exist_item.posa_row_id == el) {
						const item_offers = exist_item.posa_offers ? JSON.parse(exist_item.posa_offers) : [];
						if (!Array.isArray(item_offers)) return;

						if (!item_offers.includes(offer.row_id)) {
							item_offers.push(offer.row_id);
							if (offer.offer === "Item Price") {
								exist_item.posa_offer_applied = 1;
							}
						}
						exist_item.posa_offers = JSON.stringify(item_offers);
					}
				});
			});
		} catch (error) {
			console.error("Error adding offer to items:", error);
			this.eventBus.emit("show_message", {
				title: __("Error adding offer to items"),
				color: "error",
				message: error.message,
			});
		}
	},

	deleteOfferFromItems(offer) {
		if (!offer || !offer.items) return;

		try {
			const offer_items = typeof offer.items === "string" ? JSON.parse(offer.items) : offer.items;
			if (!Array.isArray(offer_items)) return;

			const combined = [...this.items, ...this.packed_items];
			offer_items.forEach((el) => {
				combined.forEach((exist_item) => {
					if (!exist_item || !exist_item.posa_row_id) return;

					if (exist_item.posa_row_id == el) {
						const item_offers = exist_item.posa_offers ? JSON.parse(exist_item.posa_offers) : [];
						if (!Array.isArray(item_offers)) return;

						const updated_item_offers = item_offers.filter((row_id) => row_id != offer.row_id);
						if (offer.offer === "Item Price") {
							exist_item.posa_offer_applied = 0;
						}
						exist_item.posa_offers = JSON.stringify(updated_item_offers);
					}
				});
			});
		} catch (error) {
			console.error("Error deleting offer from items:", error);
			this.eventBus.emit("show_message", {
				title: __("Error deleting offer from items"),
				color: "error",
				message: error.message,
			});
		}
	},

	async checkAndApplyOffersForNewItem(addedItem) {
		try {
			// Ensure we have offers loaded
			if (!this.posOffers || !this.posOffers.length) {
				return;
			}

			// Find the newly added item in the cart
			const newItem = this.items.find(item => 
				item.item_code === addedItem.item_code && 
				item.posa_row_id === addedItem.posa_row_id
			);

			if (!newItem) {
				return;
			}

			// Check offers that apply to this specific item
			const applicableOffers = this.posOffers.filter(offer => {
				// Check if offer applies to this item
				if (offer.apply_on === "Item Code" && offer.apply_item_code === newItem.item_code) {
					return true;
				}
				if (offer.apply_on === "Item Group" && newItem.item_group === offer.apply_item_group) {
					return true;
				}
				if (offer.apply_on === "Brand" && newItem.brand === offer.apply_brand) {
					return true;
				}
				if (offer.apply_on === "Family" && newItem.custom_la_famille && this.normalizeString(newItem.custom_la_famille) === this.normalizeString(offer.apply_rule_on_family)) {
					return true;
				}
				if (offer.apply_on === "Collection" && newItem.custom_la_collection && this.normalizeString(newItem.custom_la_collection) === this.normalizeString(offer.apply_rule_on_collection)) {
					return true;
				}
				if (offer.apply_on === "Template" && newItem.variant_of && this.normalizeString(newItem.variant_of) === this.normalizeString(offer.apply_rule_on_template)) {
					return true;
				}
				return false;
			});

			// Apply auto-applicable offers immediately
			let hasAutoOffer = false;
			for (const offer of applicableOffers) {
				if (offer.auto && this.isOfferApplicable(offer, newItem)) {
					await this.applyOfferToItem(offer, newItem);
					hasAutoOffer = true;
				}
			}

			// Show notification if offers were applied
			if (hasAutoOffer) {
				this.eventBus.emit("show_message", {
					title: __("Offer Applied"),
					color: "success",
					indeterminate: false,
				});
			}

		} catch (error) {
			console.error("Error checking offers for new item:", error);
		}
	},

	isOfferApplicable(offer, item) {
		// Check minimum quantity
		if (offer.min_qty && item.qty < offer.min_qty) {
			return false;
		}

		// Check minimum amount
		if (offer.min_amt) {
			const itemAmount = item.qty * item.rate;
			if (itemAmount < offer.min_amt) {
				return false;
			}
		}

		// Additional conditions can be added here
		return true;
	},

	async applyOfferToItem(offer, item) {
		try {
			// Mark the offer as applied
			const offerIndex = this.posOffers.findIndex(o => o.name === offer.name);
			if (offerIndex !== -1) {
				this.posOffers[offerIndex].offer_applied = true;
			}

			// Apply the offer based on its type
			if (offer.offer === "Item Price") {
				await this.applyItemPriceOffer(offer, item);
			} else if (offer.offer === "Give Product") {
				await this.applyGiveProductOffer(offer, item);
			}

			// Update the item's offer status
			item.posa_offer_applied = 1;
			
			// Force UI update
			this.$forceUpdate();

		} catch (error) {
			console.error("Error applying offer to item:", error);
		}
	},

	async applyItemPriceOffer(offer, item) {
		// Apply discount based on offer type
		console.log("DEBUG: applyItemPriceOffer called", {
			offer_discount_type: offer.discount_type,
			offer_discount_type_trimmed: `"${offer.discount_type}"`.trim(),
			comparison_with_percentage: offer.discount_type === "Percentage",
			comparison_with_amount: offer.discount_type === "Amount", 
			comparison_with_rate: offer.discount_type === "Rate",
			comparison_with_buying_price: offer.discount_type === "Buying Price"
		});

		try {
			const itemOffers = item.posa_offers ? JSON.parse(item.posa_offers) : [];
			if (!itemOffers.includes(offer.name)) {
				itemOffers.push(offer.name);
				item.posa_offers = JSON.stringify(itemOffers);
			}

			// Apply the actual discount based on discount type
			if (offer.discount_type === "Buying Price") {
				console.log("DEBUG: applyItemPriceOffer - Applying Buying Price discount", {
					offer: offer,
					item: item,
					item_fields: Object.keys(item)
				});
				
				// Try different possible field names for buying price
				const item_buying_price = item.buying_price || item.purchase_price || item.cost_price || item.actual_cost_rate || 0;
				
				console.log("DEBUG: applyItemPriceOffer - Item buying price found", item_buying_price);
				
				if (!item_buying_price) {
					console.log("DEBUG: applyItemPriceOffer - No buying price found, skipping offer");
					return;
				}
				
				const base_price = item.base_rate || item.rate / this.exchange_rate;
				const new_selling_price_base = item_buying_price + (offer.buying_price || 0);
				const base_discount = base_price - new_selling_price_base;
				
				console.log("DEBUG: applyItemPriceOffer - Buying Price calculation", {
					base_price,
					item_buying_price,
					offer_buying_price: offer.buying_price,
					new_selling_price_base,
					base_discount
				});
				
				// Apply the discount to the item
				if (base_discount > 0) {
					item.discount_amount = base_discount;
					item.base_rate = new_selling_price_base;
					item.rate = this.selected_currency !== this.pos_profile.currency 
						? new_selling_price_base * this.exchange_rate 
						: new_selling_price_base;
					item.posa_is_offer = 1;
					
					console.log("DEBUG: applyItemPriceOffer - Discount applied", {
						new_rate: item.rate,
						discount_amount: item.discount_amount
					});
				}
			}
		} catch (error) {
			console.error("Error applying offer to item:", error);
		}
	},

	async applyGiveProductOffer(offer, item) {
		// This would add a free item to the cart
		// Implementation depends on the specific give product logic
		console.log("Give Product offer applied:", offer.name);
	},

	validate_due_date(item) {
		const today = frappe.datetime.now_date();
		const parse_today = Date.parse(today);
		// Convert to backend format for comparison
		const backend_date = this.formatDateForBackend(item.posa_delivery_date);
		const new_date = Date.parse(backend_date);
		if (isNaN(new_date) || new_date < parse_today) {
			setTimeout(() => {
				item.posa_delivery_date = this.formatDateForDisplay(today);
			}, 0);
		} else {
			item.posa_delivery_date = this.formatDateForDisplay(backend_date);
		}
	},
	load_print_page(invoice_name) {
		const print_format = this.pos_profile.print_format_for_online || this.pos_profile.print_format;
		const letter_head = this.pos_profile.letter_head || 0;
		const doctype = this.pos_profile.create_pos_invoice_instead_of_sales_invoice
			? "POS Invoice"
			: "Sales Invoice";
		const debugPrint = isDebugPrintEnabled();
		let url =
			frappe.urllib.get_base_url() +
			"/printview?doctype=" +
			encodeURIComponent(doctype) +
			"&name=" +
			invoice_name +
			"&trigger_print=1" +
			"&format=" +
			print_format +
			"&no_letterhead=" +
			letter_head;
		url = appendDebugPrintParam(url, debugPrint);

		if (this.pos_profile.posa_silent_print) {
			silentPrint(url, {
				allowOfflineFallback: isOffline(),
				triggerPrint: "1",
				debugPrint,
				debugInfo: {
					printFormat: print_format,
					templatePath: "online-printview",
				},
			});
		} else {
			const printWindow = window.open(url, "Print");
			watchPrintWindow(printWindow, {
				allowOfflineFallback: isOffline(),
				triggerPrint: "1",
				debugPrint,
				debugInfo: {
					printFormat: print_format,
					templatePath: "online-printview",
				},
			});
		}
	},

	formatDateForBackend(date) {
		if (!date) return null;
		if (typeof date === "string") {
			const western = formatUtils.fromArabicNumerals(date);
			if (/^\d{4}-\d{2}-\d{2}$/.test(western)) {
				return western;
			}
			if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(western)) {
				const [d, m, y] = western.split("-");
				return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
			}
			date = western;
		}
		const d = new Date(formatUtils.fromArabicNumerals(String(date)));
		if (!isNaN(d.getTime())) {
			const year = d.getFullYear();
			const month = `0${d.getMonth() + 1}`.slice(-2);
			const day = `0${d.getDate()}`.slice(-2);
			return `${year}-${month}-${day}`;
		}
		return formatUtils.fromArabicNumerals(String(date));
	},

	formatDateForDisplay(date) {
		if (!date) return "";
		const western = formatUtils.fromArabicNumerals(String(date));
		if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(western)) {
			const [y, m, d] = western.split("-");
			return formatUtils.toArabicNumerals(`${d}-${m}-${y}`);
		}
		const d = new Date(western);
		if (!isNaN(d.getTime())) {
			const year = d.getFullYear();
			const month = `0${d.getMonth() + 1}`.slice(-2);
			const day = `0${d.getDate()}`.slice(-2);
			return formatUtils.toArabicNumerals(`${day}-${month}-${year}`);
		}
		return formatUtils.toArabicNumerals(western);
	},

	toggleOffer(item) {
		this.$nextTick(() => {
			if (item.posa_offer_applied) {
				// Remove applied offer and restore original pricing
				item.posa_is_offer = 1;
				item.posa_offers = JSON.stringify([]);
				item.posa_offer_applied = 0;
				item.discount_percentage = 0;
				item.discount_amount = 0;
				item.base_discount_amount = 0;

				// Restore previous rates if stored, adjusted for current UOM
				const cf = flt(item.conversion_factor || 1);
				item.rate = item.original_rate ? item.original_rate * cf : item.price_list_rate;
				item.price_list_rate = item.original_price_list_rate
					? item.original_price_list_rate * cf
					: item.price_list_rate;
				item.base_rate = item.original_base_rate ? item.original_base_rate * cf : item.base_rate;
				item.base_price_list_rate = item.original_base_price_list_rate
					? item.original_base_price_list_rate * cf
					: item.base_price_list_rate;

				// Clear stored original rates
				item.original_rate = null;
				item.original_price_list_rate = null;
				item.original_base_rate = null;
				item.original_base_price_list_rate = null;

				this.calc_item_price(item);
				this.handelOffers();
			} else {
				// Allow offers to be applied
				item.posa_is_offer = 0;
				this.handelOffers();
			}

			// Ensure Vue reactivity
			this.$forceUpdate();
		});
	},
};
