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
							@update:model-value="handleAdditionalDiscountUpdate"
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
							@update:model-value="handleAdditionalDiscountPercentageUpdate"
							@change="$emit('update_discount_umount')"
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

					<!-- Total (Editable) -->
					<v-col cols="6">
						<v-text-field
							ref="totalField"
							v-model="editableTotalDisplay"
							@update:model-value="handleTotalUpdate"
							@focus="handleTotalFocus"
							@blur="handleTotalBlur"
							:label="frappe._('Total')"
							prepend-inner-icon="mdi-cash"
							variant="solo"
							density="compact"
							color="primary"
							:prefix="currencySymbol(displayCurrency)"
							:disabled="!pos_profile.posa_allow_user_to_edit_additional_discount"
							class="summary-field"
							:placeholder="formatCurrency(0)"
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
			// Loading states for better UX
			saveLoading: false,
			loadDraftsLoading: false,
			selectOrderLoading: false,
			cancelLoading: false,
			returnsLoading: false,
			printLoading: false,
			applyOffersLoading: false,
			paymentLoading: false,
			additionalDiscountDisplay: null,
			additionalDiscountPercentageDisplay: null,
			isEditingAdditionalDiscount: false,
			isEditingAdditionalDiscountPercentage: false,
			editableTotalDisplay: null,
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
		originalGrandTotal() {
			// Calculate the original grand total (subtotal - items discount)
			return (parseFloat(this.subtotal) || 0) - (parseFloat(this.total_items_discount_amount) || 0);
		},
	},
	watch: {
		additional_discount(value) {
			if (!this.isEditingAdditionalDiscount) {
				this.additionalDiscountDisplay = this.normalizeDiscountDisplay(value);
			}
		},
		additional_discount_percentage(value) {
			if (!this.isEditingAdditionalDiscountPercentage) {
				this.additionalDiscountPercentageDisplay = this.normalizeDiscountDisplay(value);
			}
		},
		originalGrandTotal(newVal) {
			// Update editable total when original changes, but only if not editing
			if (!this.isEditingTotal && newVal !== undefined) {
				this.editableTotalDisplay = this.normalizeDiscountDisplay(newVal);
			}
		},
	},
	created() {
		this.additionalDiscountDisplay = this.normalizeDiscountDisplay(this.additional_discount);
		this.additionalDiscountPercentageDisplay = this.normalizeDiscountDisplay(
			this.additional_discount_percentage,
		);
		// Initialize editable total with current grand total
		this.editableTotalDisplay = this.normalizeDiscountDisplay(this.originalGrandTotal);
	},
	methods: {
		normalizeDiscountDisplay(value) {
			if (value === 0 || value === "0") {
				return "";
			}
			// Format as currency with 2 decimal places to avoid errors
			return this.formatCurrency(value);
		},

		// Debounced handlers for better performance
		handleAdditionalDiscountUpdate(value) {
			this.$emit("update:additional_discount", value);
		},

		handleAdditionalDiscountFocus() {
			this.isEditingAdditionalDiscount = true;
		},

		handleAdditionalDiscountBlur() {
			this.isEditingAdditionalDiscount = false;
		},

		focusAdditionalDiscountField() {
			const field = this.$refs.additionalDiscountField;
			const input = field?.$el?.querySelector?.("input");
			if (input?.disabled) {
				return;
			}
			input?.focus?.();
		},

		handleAdditionalDiscountPercentageUpdate(value) {
			this.$emit("update:additional_discount_percentage", value);
		},

		handleAdditionalDiscountPercentageFocus() {
			this.isEditingAdditionalDiscountPercentage = true;
		},

		handleAdditionalDiscountPercentageBlur() {
			this.isEditingAdditionalDiscountPercentage = false;
		},

		async handleSaveAndClear() {
			this.saveLoading = true;
			try {
				await this.$emit("save-and-clear");
			} finally {
				this.saveLoading = false;
			}
		},

		async handleLoadDrafts() {
			this.loadDraftsLoading = true;
			try {
				await this.$emit("load-drafts");
			} finally {
				this.loadDraftsLoading = false;
			}
		},

		async handleSelectOrder() {
			this.selectOrderLoading = true;
			try {
				await this.$emit("select-order");
			} finally {
				this.selectOrderLoading = false;
			}
		},

		async handleCancelSale() {
			this.cancelLoading = true;
			try {
				await this.$emit("cancel-sale");
			} finally {
				this.cancelLoading = false;
			}
		},

		async handleOpenReturns() {
			this.returnsLoading = true;
			try {
				await this.$emit("open-returns");
			} finally {
				this.returnsLoading = false;
			}
		},

		async handlePrintDraft() {
			this.printLoading = true;
			try {
				await this.$emit("print-draft");
			} finally {
				this.printLoading = false;
			}
		},

		async handleApplyOffers() {
			this.applyOffersLoading = true;
			try {
				await this.$emit("apply-offers");
			} finally {
				this.applyOffersLoading = false;
			}
		},

		async handleShowPayment() {
			this.paymentLoading = true;
			try {
				await this.$emit("show-payment");
			} finally {
				this.paymentLoading = false;
			}
		},

		// Total editing handlers
		handleTotalUpdate(value) {
			this.calculateAndApplyDiscount(value);
		},

		handleTotalFocus() {
			this.isEditingTotal = true;
		},

		handleTotalBlur() {
			this.isEditingTotal = false;
		},

		calculateAndApplyDiscount(newTotal) {
			if (!newTotal || !this.originalGrandTotal) {
				return;
			}

			// Parse the input value - handle both "5000" and "5000.00" formats
			const parsedNewTotal = parseFloat(newTotal.toString().replace(/[^\d.-]/g, '')) || 0;
			const baseTotal = parseFloat(this.originalGrandTotal) || 0;
			
			if (parsedNewTotal <= 0) {
				// Reset to original if invalid
				this.editableTotalDisplay = this.normalizeDiscountDisplay(baseTotal);
				this.$emit("update:additional_discount", 0);
				return;
			}

			// Calculate the discount needed
			const discountAmount = baseTotal - parsedNewTotal;
			
			// Apply the discount by emitting the update event
			if (discountAmount >= 0) {
				this.$emit("update:additional_discount", discountAmount);
			} else {
				// If new total is higher than base, set discount to 0
				this.$emit("update:additional_discount", 0);
			}
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

/* Enhanced button styling with better performance */
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

/* Special styling for the PAY button */
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

/* Enhanced field styling */
.summary-field {
	transition: all 0.2s ease;
}

.summary-field:hover {
	transform: translateY(-1px);
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* Responsive optimizations */
@media (max-width: 768px) {
	.summary-btn {
		font-size: 0.875rem !important;
		padding: 8px 12px !important;
	}

	.pay-btn {
		font-size: 1rem !important;
	}

	.summary-field {
		font-size: 0.875rem;
	}
}

@media (max-width: 480px) {
	.summary-btn {
		font-size: 0.8rem !important;
		padding: 6px 8px !important;
	}

	.pay-btn {
		font-size: 0.95rem !important;
	}
}

/* Loading state animations */
.summary-btn:deep(.v-btn__loader) {
	opacity: 0.8;
}

/* Dark theme enhancements */
:deep([data-theme="dark"]) .summary-btn,
:deep(.v-theme--dark) .summary-btn {
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
}

:deep([data-theme="dark"]) .summary-btn:hover,
:deep(.v-theme--dark) .summary-btn:hover {
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
}
</style>
