<template>
	<v-card
		class="cards mb-0 mt-3 py-2 px-3 rounded-lg resizable pos-themed-card"
		style="resize: vertical; overflow: auto"
	>
		<v-row dense>
			<!-- Summary Info -->
			<v-col cols="12" md="7">
				<v-row dense>
					<!-- Total Qty -->
					<v-col cols="6">
						<v-text-field
							:model-value="formatFloat(total_qty, hide_qty_decimals ? 0 : undefined)"
							:label="frappe._('Total Qty')"
							prepend-inner-icon="mdi-format-list-numbered"
							variant="solo"
							density="compact"
							readonly
							color="accent"
						/>
					</v-col>

					<!-- Additional Discount (Amount or Percentage) -->
					<v-col cols="6" v-if="!pos_profile.posa_use_percentage_discount">
						<v-text-field
							ref="additionalDiscountField"
							v-model="additionalDiscountDisplay"
							@change="handleAdditionalDiscountChange"
							@focus="handleAdditionalDiscountFocus"
							@blur="handleAdditionalDiscountBlur"
							:label="frappe._('Additional Discount')"
							prepend-inner-icon="mdi-cash-minus"
							variant="solo"
							density="compact"
							color="warning"
							:prefix="currencySymbol(pos_profile.currency)"
							:disabled="
								!pos_profile.posa_allow_user_to_edit_additional_discount ||
								!!discount_percentage_offer_name
							"
							class="summary-field"
						/>
					</v-col>

					<v-col cols="6" v-else>
						<v-text-field
							ref="additionalDiscountField"
							v-model="additionalDiscountPercentageDisplay"
							@change="handleAdditionalDiscountPercentageChange"
							@focus="handleAdditionalDiscountPercentageFocus"
							@blur="handleAdditionalDiscountPercentageBlur"
							:rules="[isNumber]"
							:label="frappe._('Additional Discount %')"
							suffix="%"
							prepend-inner-icon="mdi-percent"
							variant="solo"
							density="compact"
							color="warning"
							:disabled="
								!pos_profile.posa_allow_user_to_edit_additional_discount ||
								!!discount_percentage_offer_name
							"
							class="summary-field"
						/>
					</v-col>

					<!-- Items Discount -->
					<v-col cols="6">
						<v-text-field
							:model-value="formatCurrency(total_items_discount_amount)"
							:prefix="currencySymbol(displayCurrency)"
							:label="frappe._('Items Discounts')"
							prepend-inner-icon="mdi-tag-minus"
							variant="solo"
							density="compact"
							color="warning"
							readonly
							class="summary-field"
						/>
					</v-col>

					<!-- Total — editable: typing a new total auto-calculates additional discount -->
					<v-col cols="6">
						<v-text-field
							v-model="editableTotalDisplay"
							:prefix="currencySymbol(displayCurrency)"
							:label="frappe._('Total')"
							prepend-inner-icon="mdi-cash"
							variant="solo"
							density="compact"
							color="primary"
							:disabled="!pos_profile.posa_allow_user_to_edit_additional_discount"
							class="summary-field"
							@focus="handleTotalFocus"
							@change="handleTotalChange"
							@blur="handleTotalBlur"
							@keydown.enter="handleTotalChange"
						/>
					</v-col>
				</v-row>
			</v-col>

			<!-- Action Buttons -->
			<v-col cols="12" md="5">
				<v-row dense>
					<v-col cols="6">
						<v-btn
							block
							color="accent"
							theme="dark"
							prepend-icon="mdi-content-save"
							@click="handleSaveAndClear"
							class="summary-btn"
							:loading="saveLoading"
						>
							{{ __("Save & Clear") }}
						</v-btn>
					</v-col>
					<v-col cols="6">
						<v-btn
							block
							color="warning"
							theme="dark"
							prepend-icon="mdi-file-document"
							@click="handleLoadDrafts"
							class="white-text-btn summary-btn"
							:loading="loadDraftsLoading"
						>
							{{ __("Load Drafts") }}
						</v-btn>
					</v-col>
					<v-col cols="6" v-if="pos_profile.custom_allow_select_sales_order == 1">
						<v-btn
							block
							color="info"
							theme="dark"
							prepend-icon="mdi-book-search"
							@click="handleSelectOrder"
							class="summary-btn"
							:loading="selectOrderLoading"
						>
							{{ __("Select S.O") }}
						</v-btn>
					</v-col>
					<v-col cols="6">
						<v-btn
							block
							color="error"
							theme="dark"
							prepend-icon="mdi-close-circle"
							@click="handleCancelSale"
							class="summary-btn"
							:loading="cancelLoading"
						>
							{{ __("Cancel Sale") }}
						</v-btn>
					</v-col>
					<v-col cols="6" v-if="pos_profile.posa_allow_return == 1">
						<v-btn
							block
							color="secondary"
							theme="dark"
							prepend-icon="mdi-backup-restore"
							@click="handleOpenReturns"
							class="summary-btn"
							:loading="returnsLoading"
						>
							{{ __("Sales Return") }}
						</v-btn>
					</v-col>
					<v-col cols="6" v-if="pos_profile.posa_allow_print_draft_invoices">
						<v-btn
							block
							color="primary"
							theme="dark"
							prepend-icon="mdi-printer"
							@click="handlePrintDraft"
							class="summary-btn"
							:loading="printLoading"
						>
							{{ __("Print Draft") }}
						</v-btn>
					</v-col>
					<v-col cols="6">
						<v-btn
							block
							color="info"
							theme="dark"
							prepend-icon="mdi-tag"
							@click="handleApplyOffers"
							class="summary-btn"
							:loading="applyOffersLoading"
						>
							{{ __("Apply Offers") }}
						</v-btn>
					</v-col>
					<v-col cols="12">
						<v-btn
							block
							color="success"
							theme="dark"
							size="large"
							prepend-icon="mdi-credit-card"
							@click="handleShowPayment"
							class="summary-btn pay-btn"
							:loading="paymentLoading"
						>
							{{ __("PAY") }}
						</v-btn>
					</v-col>
				</v-row>
			</v-col>
		</v-row>
	</v-card>
</template>

<script>
export default {
	props: {
		pos_profile: Object,
		total_qty: [Number, String],
		additional_discount: Number,
		additional_discount_percentage: Number,
		total_items_discount_amount: Number,
		subtotal: Number,
		displayCurrency: String,
		formatFloat: Function,
		formatCurrency: Function,
		currencySymbol: Function,
		discount_percentage_offer_name: [String, Number],
		isNumber: Function,
	},
	data() {
		return {
			saveLoading: false,
			loadDraftsLoading: false,
			selectOrderLoading: false,
			cancelLoading: false,
			returnsLoading: false,
			printLoading: false,
			applyOffersLoading: false,
			paymentLoading: false,
			// Local display values — kept in sync with props via watchers
			additionalDiscountDisplay: "",
			additionalDiscountPercentageDisplay: "",
			editableTotalDisplay: "",
			isEditingAdditionalDiscount: false,
			isEditingAdditionalDiscountPercentage: false,
			isEditingTotal: false,
		};
	},
	emits: [
		"update:additional_discount",
		"update:additional_discount_percentage",
		"update_discount_umount",
		"save-and-clear",
		"load-drafts",
		"select-order",
		"cancel-sale",
		"open-returns",
		"print-draft",
		"apply-offers",
		"show-payment",
	],
	computed: {
		hide_qty_decimals() {
			try {
				const saved = localStorage.getItem("posawesome_item_selector_settings");
				if (saved) {
					const opts = JSON.parse(saved);
					return !!opts.hide_qty_decimals;
				}
			} catch (e) {
				console.error("Failed to load item selector settings:", e);
			}
			return false;
		},
	},
	watch: {
		additional_discount(value) {
			if (!this.isEditingAdditionalDiscount) {
				this.additionalDiscountDisplay = this.toDisplayString(value);
			}
			// Also resync total display when discount changes externally (e.g. offers applied)
			if (!this.isEditingTotal) {
				this.editableTotalDisplay = this.toDisplayString(this.subtotal);
			}
		},
		additional_discount_percentage(value) {
			if (!this.isEditingAdditionalDiscountPercentage) {
				this.additionalDiscountPercentageDisplay = this.toDisplayString(value);
			}
		},
		// Keep total display in sync whenever parent recalculates grand_total
		subtotal(value) {
			if (!this.isEditingTotal) {
				this.editableTotalDisplay = this.toDisplayString(value);
			}
		},
	},
	created() {
		this.additionalDiscountDisplay = this.toDisplayString(this.additional_discount);
		this.additionalDiscountPercentageDisplay = this.toDisplayString(this.additional_discount_percentage);
		this.editableTotalDisplay = this.toDisplayString(this.subtotal);
	},
	methods: {
		// Convert a number to a display string: 0 → "" so field looks empty, otherwise raw number
		toDisplayString(value) {
			const n = parseFloat(value);
			if (!n || n === 0) return "";
			return String(n);
		},

		// Strip any formatting (commas, currency symbols) and return a clean number
		parseInput(val) {
			return parseFloat(String(val || "").replace(/[^\d.]/g, "")) || 0;
		},

		// ── Additional Discount (amount) ──────────────────────────────────
		handleAdditionalDiscountFocus() {
			this.isEditingAdditionalDiscount = true;
			// Show raw number so user can edit cleanly
			const raw = parseFloat(this.additional_discount) || 0;
			this.additionalDiscountDisplay = raw > 0 ? String(raw) : "";
		},
		handleAdditionalDiscountChange() {
			// Fires on Enter — emit the parsed value
			const parsed = this.parseInput(this.additionalDiscountDisplay);
			this.$emit("update:additional_discount", parsed);
		},
		handleAdditionalDiscountBlur() {
			this.isEditingAdditionalDiscount = false;
			// Emit final parsed value on blur
			const parsed = this.parseInput(this.additionalDiscountDisplay);
			this.$emit("update:additional_discount", parsed);
			// Reset display to plain number (watcher will reformat if prop changes)
			this.additionalDiscountDisplay = this.toDisplayString(parsed);
		},

		// ── Additional Discount (percentage) ─────────────────────────────
		handleAdditionalDiscountPercentageFocus() {
			this.isEditingAdditionalDiscountPercentage = true;
			const raw = parseFloat(this.additional_discount_percentage) || 0;
			this.additionalDiscountPercentageDisplay = raw > 0 ? String(raw) : "";
		},
		handleAdditionalDiscountPercentageChange() {
			const parsed = this.parseInput(this.additionalDiscountPercentageDisplay);
			this.$emit("update:additional_discount_percentage", parsed);
			this.$emit("update_discount_umount");
		},
		handleAdditionalDiscountPercentageBlur() {
			this.isEditingAdditionalDiscountPercentage = false;
			const parsed = this.parseInput(this.additionalDiscountPercentageDisplay);
			this.$emit("update:additional_discount_percentage", parsed);
			this.$emit("update_discount_umount");
			this.additionalDiscountPercentageDisplay = this.toDisplayString(parsed);
		},

		// ── Editable Total ────────────────────────────────────────────────
		// KEY FORMULA:
		//   subtotal (from parent) = grand_total = items_total - items_disc - additional_disc
		//   base_before_additional  = subtotal + additional_discount
		//   when user types newTotal → discountNeeded = base_before_additional - newTotal
		handleTotalFocus() {
			this.isEditingTotal = true;
			// Show plain number so user can type without fighting formatting
			const raw = parseFloat(this.subtotal) || 0;
			this.editableTotalDisplay = raw > 0 ? String(raw) : "";
		},
		handleTotalChange() {
			this._applyTotalEdit();
		},
		handleTotalBlur() {
			this.isEditingTotal = false;
			this._applyTotalEdit();
		},
		_applyTotalEdit() {
			const newTotal = this.parseInput(this.editableTotalDisplay);
			// base = what the total would be with zero additional discount
			const baseBeforeAdditional =
				(parseFloat(this.subtotal) || 0) + (parseFloat(this.additional_discount) || 0);

			if (newTotal <= 0 || newTotal > baseBeforeAdditional) {
				// Invalid input → reset to current grand total, clear additional discount
				this.$emit("update:additional_discount", 0);
				this.editableTotalDisplay = this.toDisplayString(baseBeforeAdditional);
				return;
			}

			const discountNeeded = baseBeforeAdditional - newTotal;
			this.$emit("update:additional_discount", discountNeeded);
			// Show what was typed (parent will update subtotal prop → watcher will reformat on blur)
			this.editableTotalDisplay = this.toDisplayString(newTotal);
		},

		// ── Utility ───────────────────────────────────────────────────────
		focusAdditionalDiscountField() {
			const field = this.$refs.additionalDiscountField;
			const input = field?.$el?.querySelector?.("input");
			if (!input?.disabled) input?.focus?.();
		},

		// ── Button handlers ───────────────────────────────────────────────
		async handleSaveAndClear() {
			this.saveLoading = true;
			try { await this.$emit("save-and-clear"); } finally { this.saveLoading = false; }
		},
		async handleLoadDrafts() {
			this.loadDraftsLoading = true;
			try { await this.$emit("load-drafts"); } finally { this.loadDraftsLoading = false; }
		},
		async handleSelectOrder() {
			this.selectOrderLoading = true;
			try { await this.$emit("select-order"); } finally { this.selectOrderLoading = false; }
		},
		async handleCancelSale() {
			this.cancelLoading = true;
			try { await this.$emit("cancel-sale"); } finally { this.cancelLoading = false; }
		},
		async handleOpenReturns() {
			this.returnsLoading = true;
			try { await this.$emit("open-returns"); } finally { this.returnsLoading = false; }
		},
		async handlePrintDraft() {
			this.printLoading = true;
			try { await this.$emit("print-draft"); } finally { this.printLoading = false; }
		},
		async handleApplyOffers() {
			this.applyOffersLoading = true;
			try { await this.$emit("apply-offers"); } finally { this.applyOffersLoading = false; }
		},
		async handleShowPayment() {
			this.paymentLoading = true;
			try { await this.$emit("show-payment"); } finally { this.paymentLoading = false; }
		},
	},
};
</script>

<style scoped>
.cards {
	background-color: var(--pos-card-bg) !important;
	transition: all 0.3s ease;
}

.white-text-btn {
	color: var(--pos-text-primary) !important;
}

.white-text-btn :deep(.v-btn__content) {
	color: var(--pos-text-primary) !important;
}

.summary-btn {
	transition: all 0.2s ease !important;
	position: relative;
	overflow: hidden;
}

.summary-btn :deep(.v-btn__content) {
	white-space: normal !important;
	transition: all 0.2s ease;
}

.summary-btn:hover {
	transform: translateY(-1px);
	box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15) !important;
}

.summary-btn:active {
	transform: translateY(0);
}

.pay-btn {
	font-weight: 600 !important;
	font-size: 1.1rem !important;
	background: linear-gradient(135deg, #4caf50, #45a049) !important;
	box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3) !important;
}

.pay-btn:hover {
	background: linear-gradient(135deg, #45a049, #3d8b40) !important;
	box-shadow: 0 6px 16px rgba(76, 175, 80, 0.4) !important;
	transform: translateY(-2px);
}

.summary-field {
	transition: all 0.2s ease;
}

.summary-field:hover {
	transform: translateY(-1px);
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

@media (max-width: 768px) {
	.summary-btn { font-size: 0.875rem !important; padding: 8px 12px !important; }
	.pay-btn { font-size: 1rem !important; }
	.summary-field { font-size: 0.875rem; }
}

@media (max-width: 480px) {
	.summary-btn { font-size: 0.8rem !important; padding: 6px 8px !important; }
	.pay-btn { font-size: 0.95rem !important; }
}

.summary-btn:deep(.v-btn__loader) { opacity: 0.8; }

:deep([data-theme="dark"]) .summary-btn,
:deep(.v-theme--dark) .summary-btn {
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
}

:deep([data-theme="dark"]) .summary-btn:hover,
:deep(.v-theme--dark) .summary-btn:hover {
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
}
</style>
