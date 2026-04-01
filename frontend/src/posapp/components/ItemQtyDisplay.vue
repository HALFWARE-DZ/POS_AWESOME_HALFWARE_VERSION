<template>
	<div class="item-qty-display">
		<!-- Loading state -->
		<span v-if="loading" class="text-caption text-grey">
			<v-icon size="small" class="mdi-spin">mdi-loading</v-icon>
			{{ __("Loading...") }}
		</span>
		
		<!-- Error state -->
		<span v-else-if="error" class="text-caption text-error">
			<v-icon size="small">mdi-alert-circle</v-icon>
			{{ __("N/A") }}
		</span>
		
		<!-- Normal display -->
		<div v-else class="d-flex align-center">
			<span class="text-caption">
				{{ __("Available: {0}", [formatFloat(availableQty)]) }}
			</span>
			
			<span 
				v-if="reservedQty > 0" 
				class="text-caption ml-2 text-warning cursor-pointer"
				@mouseenter="showTooltip = true"
				@mouseleave="showTooltip = false"
				ref="reservedElement"
			>
				{{ __("Reserved: {0}", [formatFloat(reservedQty)]) }}
				<v-icon size="x-small" class="ml-1">mdi-information</v-icon>
			</span>
		</div>
		
		<!-- Tooltip with reservation details -->
		<v-menu
			v-model="showTooltip"
			:target="reservedElement"
			:close-on-content-click="false"
			location="top"
			max-width="300"
		>
			<v-card class="reservation-tooltip">
				<v-card-title class="text-h6 pa-3">
					<v-icon class="mr-2">mdi-clipboard-text</v-icon>
					{{ __("Reserved Items") }}
				</v-card-title>
				
				<v-divider></v-divider>
				
				<v-card-text class="pa-0">
					<div v-if="reservedList.length === 0" class="text-center pa-3 text-grey">
						{{ __("No reservations found") }}
					</div>
					
					<div v-else class="reservation-list">
						<div
							v-for="(reservation, index) in reservedList"
							:key="index"
							class="reservation-item pa-3"
							:class="{ 'border-top': index > 0 }"
						>
							<div class="d-flex justify-space-between align-start">
								<div class="flex-grow-1">
									<div class="font-weight-medium text-body-2">
										{{ reservation.invoice_name }}
									</div>
									<div v-if="reservation.customer_name" class="text-caption text-grey mt-1">
										{{ __("Customer: {0}", [reservation.customer_name]) }}
									</div>
								</div>
								<div class="text-right">
									<div class="font-weight-bold text-warning">
										{{ formatFloat(reservation.qty) }}
									</div>
									<div v-if="reservation.due_date" class="text-caption text-grey mt-1">
										{{ __("Due: {0}", [reservation.due_date]) }}
									</div>
								</div>
							</div>
						</div>
					</div>
				</v-card-text>
				
				<v-card-actions v-if="reservedList.length > 0" class="pa-2">
					<v-spacer></v-spacer>
					<v-btn size="small" variant="text" @click="showTooltip = false">
						{{ __("Close") }}
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-menu>
	</div>
</template>

<script>
import { ref, computed, watch, onMounted, nextTick } from 'vue';

export default {
	name: 'ItemQtyDisplay',
	
	props: {
		itemCode: {
			type: String,
			required: true
		},
		warehouse: {
			type: String,
			required: true
		},
		formatFloat: {
			type: Function,
			default: (value) => {
				return parseFloat(value || 0).toFixed(2);
			}
		}
	},
	
	setup(props) {
		const loading = ref(false);
		const error = ref(false);
		const availableQty = ref(0);
		const reservedQty = ref(0);
		const reservedList = ref([]);
		const showTooltip = ref(false);
		const reservedElement = ref(null);
		
		// Fetch quantity summary
		const fetchQtySummary = async () => {
			if (!props.itemCode || !props.warehouse) {
				return;
			}
			
			loading.value = true;
			error.value = false;
			
			try {
				const result = await frappe.call({
					method: 'posawesome.posawesome.api.stock_reservation.get_item_qty_summary',
					args: {
						item_code: props.itemCode,
						warehouse: props.warehouse
					}
				});
				
				if (result && result.message) {
					const data = result.message;
					availableQty.value = data.available_qty || 0;
					reservedQty.value = data.reserved_qty || 0;
					reservedList.value = data.reserved_list || [];
				} else {
					throw new Error('Invalid response from server');
				}
				
			} catch (err) {
				console.error('Error fetching item quantity summary:', err);
				error.value = true;
				// Reset values on error
				availableQty.value = 0;
				reservedQty.value = 0;
				reservedList.value = [];
			} finally {
				loading.value = false;
			}
		};
		
		// Watch for prop changes
		watch([() => props.itemCode, () => props.warehouse], () => {
			if (props.itemCode && props.warehouse) {
				fetchQtySummary();
			}
		}, { immediate: true });
		
		// Fetch on mount if props are available
		onMounted(() => {
			if (props.itemCode && props.warehouse) {
				fetchQtySummary();
			}
		});
		
		return {
			loading,
			error,
			availableQty,
			reservedQty,
			reservedList,
			showTooltip,
			reservedElement,
			fetchQtySummary
		};
	}
};
</script>

<style scoped>
.item-qty-display {
	display: inline-block;
}

.reservation-tooltip {
	max-height: 400px;
	overflow-y: auto;
}

.reservation-item {
	transition: background-color 0.2s ease;
}

.reservation-item:hover {
	background-color: rgba(0, 0, 0, 0.04);
}

.border-top {
	border-top: 1px solid rgba(0, 0, 0, 0.12);
}

.cursor-pointer {
	cursor: pointer;
}

.cursor-pointer:hover {
	text-decoration: underline;
}

/* RTL support */
.rtl .cursor-pointer:hover {
	text-decoration: underline;
}
</style>
