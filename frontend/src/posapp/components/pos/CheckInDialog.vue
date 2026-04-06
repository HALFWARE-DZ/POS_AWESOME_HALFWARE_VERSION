<template>

	<v-dialog v-model="dialog" max-width="480px" persistent>

		<v-card>

			<v-card-title class="text-h6 pa-4 d-flex align-center">

				<v-icon class="mr-2">mdi-cash-plus</v-icon>

				{{ __("Receive Money") }}

				<v-spacer></v-spacer>

				<v-btn icon="mdi-close" variant="text" @click="closeDialog"></v-btn>

			</v-card-title>

			<v-divider></v-divider>



			<v-card-text class="pa-4">

				<!-- Mode of Payment -->

				<v-select

					v-model="modeOfPayment"

					:items="modesOfPayment"

					label="Mode of Payment *"

					variant="outlined"

					density="compact"

					class="mb-3"

					:loading="loadingModes"

				></v-select>



				<!-- Amount -->

				<v-text-field

					v-model.number="receivedAmount"

					label="Amount *"

					variant="outlined"

					density="compact"

					type="number"

					prefix="DZD"

					class="mb-3"

					:rules="[v => !!v && v > 0 || 'Must be > 0']"

				></v-text-field>



				<!-- Source / Remark -->

				<v-textarea

					v-model="remark"

					label="Source / Remark *"

					variant="outlined"

					density="compact"

					rows="2"

					class="mb-1"

					placeholder="Who/where is this money from? (e.g., Owner deposit, Customer payment, etc.)"

					:rules="[v => !!v || 'Please specify source']"

				></v-textarea>



			</v-card-text>



			<v-card-actions class="pa-4 pt-0">

				<v-btn color="grey" variant="text" @click="closeDialog">{{ __("Cancel") }}</v-btn>

				<v-spacer></v-spacer>

				<v-btn 

					@click="processCheckIn" 

					color="primary" 

					variant="tonal"

					:disabled="!canProcess" 
					
					:loading="processing"

				>

					{{ __("Receive Money") }}

				</v-btn>

			</v-card-actions>

		</v-card>

	</v-dialog>

</template>



<script>

/* global frappe */
import { usePosShift } from '../../composables/usePosShift.js';
import { getCurrentInstance } from 'vue';
import { getOpeningStorage } from '../../../offline/index.js';

export default {

	name: 'CheckInDialog',

	setup() {
		const { pos_opening_shift } = usePosShift();
		const instance = getCurrentInstance();
		return {
			pos_opening_shift,
			eventBus: instance?.proxy?.eventBus
		};
	},

	data() {

		return {

			dialog: false,

			modeOfPayment: null,

			receivedAmount: null,

			remark: '',

			modesOfPayment: [],

			loadingModes: false,

			processing: false,

			defaultCompany: null,

			defaultCurrency: null

		}

	},



	computed: {

		canProcess() {

			return this.modeOfPayment && 
			       this.receivedAmount && 
			       this.receivedAmount > 0 && 
			       this.remark && 
			       this.remark.trim() !== '';

		}

	},



	methods: {

		async openDialog() {

			try {
				if (this.dialog) return;
				
				this.dialog = true;

				await Promise.all([
					this.loadCompanyDefaults(),
					this.loadModesOfPayment()
				]);

			} catch (error) {
				console.error('Failed to open check-in dialog:', error);
				this.$emit('show-message', { 
					title: 'Error', 
					text: 'Failed to open dialog. Please try again.', 
					color: 'error' 
				});
				this.dialog = false;
			}

		},



		closeDialog() {

			this.dialog = false;

			this.$nextTick(() => {
				this.resetForm();
			});

		},



		resetForm() {

			this.modeOfPayment = null;
			this.receivedAmount = null;
			this.remark = '';

		},



		// ── Company + currency ────────────────────────────────────────────────
		async loadCompanyDefaults() {

			if (this.defaultCompany) return;

			try {

				const r = await frappe.call({

					method: 'frappe.client.get_value',

					args: { doctype: 'Global Defaults', fieldname: ['default_company', 'default_currency'] }

				});

				if (r.message) {

					this.defaultCompany = r.message.default_company;

					this.defaultCurrency = r.message.default_currency;

				}

				if (this.defaultCompany && !this.defaultCurrency) {

					const c = await frappe.call({

						method: 'frappe.client.get_value',

						args: { doctype: 'Company', filters: { name: this.defaultCompany }, fieldname: 'default_currency' }

					});

					if (c.message) this.defaultCurrency = c.message.default_currency;

				}

			} catch (e) {

				console.error('loadCompanyDefaults failed:', e);

			}

		},



		// ── Modes of payment ──────────────────────────────────────────────────
		async loadModesOfPayment() {
			if (this.modesOfPayment.length > 0) return;

			this.loadingModes = true;

			try {

				const r = await frappe.call({

					method: 'frappe.client.get_list',

					args: { 
						doctype: 'Mode of Payment', 
						fields: ['name'], 
						filters: { enabled: 1, type: 'Cash' }, 
						limit_page_length: 50 
					}

				});

				this.modesOfPayment = (r.message || []).map(m => m.name);

				this.modeOfPayment = this.modesOfPayment.includes('Cash')
					? 'Cash'
					: this.modesOfPayment[0] || null;

			} catch (e) {

				console.error('loadModesOfPayment failed:', e);

				this.$emit('show-message', { title: 'Error', text: 'Failed to load payment modes', color: 'error' });

			} finally {

				this.loadingModes = false;

			}

		},



		// ── paid_to: Cash account from Mode of Payment ────────────────────────
		async getPaidToAccount() {

			try {

				const r = await frappe.call({

					method: 'frappe.client.get',

					args: { doctype: 'Mode of Payment', name: this.modeOfPayment }

				});

				if (r.message?.accounts) {

					const row = r.message.accounts.find(a => a.company === this.defaultCompany)
						|| r.message.accounts[0];

					if (row?.default_account) return row.default_account;

				}

			} catch (e) {

				console.warn('getPaidToAccount failed:', e);

			}

			return null;

		},



		// ── Get or create "Cash Register" customer ───────────────────────────
		async getOrCreateCashRegisterCustomer() {

			try {

				// First try to find existing cash register customer
				const existingCustomer = await frappe.call({

					method: 'frappe.client.get_list',

					args: {

						doctype: 'Customer',

						filters: { customer_name: 'Cash Register' },

						fields: ['name'],

						limit_page_length: 1

					}

				});



				if (existingCustomer.message && existingCustomer.message.length > 0) {

					return existingCustomer.message[0].name;

				}



				// If not found, create a new cash register customer
				const newCustomer = await frappe.call({

					method: 'frappe.client.insert',

					args: {

						doc: {

							doctype: 'Customer',

							customer_name: 'Cash Register',

							customer_group: 'Individual',

							territory: 'All Territories',

							company: this.defaultCompany

						}

					}

				});



				if (newCustomer.message?.name) {

					return newCustomer.message.name;

				}

			} catch (error) {

				console.error('getOrCreateCashRegisterCustomer error:', error);

			}



			return null;

		},



		// ── paid_from: company default receivable account ────────────────────
		async getCompanyReceivableAccount() {

			try {

				const r = await frappe.call({

					method: 'frappe.client.get_value',

					args: { 
						doctype: 'Company', 
						filters: { name: this.defaultCompany }, 
						fieldname: ['default_receivable_account'] 
					}

				});

				if (r.message?.default_receivable_account) return r.message.default_receivable_account;

			} catch (_) {}

			return null;

		},



		// ── Main ──────────────────────────────────────────────────────────────
		async processCheckIn() {

			if (!this.canProcess) return;

			this.processing = true;

			try {

				const paidTo = await this.getPaidToAccount();

				if (!paidTo) {

					throw new Error(
						`No account configured for "${this.modeOfPayment}" → "${this.defaultCompany}". ` +
						`Go to Mode of Payment > ${this.modeOfPayment} > Accounts tab and add your company account.`
					);

				}

				// Get or create the generic "Cash Register" customer
				const cashRegisterCustomer = await this.getOrCreateCashRegisterCustomer();

				if (!cashRegisterCustomer) {
					throw new Error('Failed to create Cash Register customer.');
				}

				// Get the source account (company receivable)
				const paidFrom = await this.getCompanyReceivableAccount();

				if (!paidFrom) {
					throw new Error('No receivable account found for your company.');
				}

				await this.createPaymentEntry(cashRegisterCustomer, paidFrom, paidTo);

			} catch (error) {

				console.error('processCheckIn error:', error);

				this.$emit('show-message', { 
					title: 'Receive Money Failed', 
					text: error.message || 'Failed to receive money', 
					color: 'error' 
				});

			} finally {

				this.processing = false;

			}

		},



		// ── Payment Entry ─────────────────────────────────────────────────────
		async createPaymentEntry(cashRegisterCustomer, paidFrom, paidTo) {

			const currentShift = this.getCurrentPosOpeningShift();
			
			const doc = {

				doctype: 'Payment Entry',

				payment_type: 'Receive',

				posting_date: frappe.datetime.nowdate(),

				company: this.defaultCompany,

				mode_of_payment: this.modeOfPayment,

				party_type: 'Customer',

				party: cashRegisterCustomer,

				paid_from: paidFrom,

				paid_to: paidTo,

				paid_amount: parseFloat(this.receivedAmount),

				received_amount: parseFloat(this.receivedAmount),

				source_exchange_rate: 1,

				target_exchange_rate: 1,

				reference_no: currentShift?.name || '',

				reference_date: frappe.datetime.nowdate(),

				remarks: this.remark,

				custom_remark: this.remark,

			};

			const ins = await frappe.call({ method: 'frappe.client.insert', args: { doc } });

			if (!ins.message) throw new Error('Insert returned empty');

			await frappe.call({ method: 'frappe.client.submit', args: { doc: ins.message } });

			this.onSuccess(ins.message.name);

		},



		// ── Helper methods ────────────────────────────────────────────────────
		getCurrentPosOpeningShift() {
			// Try to get from composable first
			if (this.pos_opening_shift?.value) {
				return this.pos_opening_shift.value;
			}
			
			// Try to get from storage as fallback
			try {
				const storageData = getOpeningStorage();
				if (storageData && storageData.pos_opening_shift) {
					return storageData.pos_opening_shift;
				}
			} catch (e) {
				console.warn('Failed to get POS opening shift from storage:', e);
			}
			
			return null;
		},

		onSuccess(docname) {

			this.$emit('checkin-success', { 
				amount: this.receivedAmount, 
				remark: this.remark, 
				docname 
			});

			this.$emit('show-message', { 
				title: 'Success', 
				text: `Received ${this.receivedAmount} DZD — ${docname}`, 
				color: 'success' 
			});

			this.closeDialog();

		}

	}

}

</script>

<style scoped>

.v-dialog > .v-overlay__content {

	border-radius: 12px;

}

</style>
