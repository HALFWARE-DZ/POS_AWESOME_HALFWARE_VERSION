<template>

	<v-dialog v-model="dialog" max-width="480px" persistent>

		<v-card>

			<v-card-title class="text-h6 pa-4 d-flex align-center">

				<v-icon class="mr-2">mdi-cash</v-icon>

				{{ __("Payment") }}

				<v-spacer></v-spacer>

				<v-btn icon="mdi-close" variant="text" @click="closeDialog"></v-btn>

			</v-card-title>

			<v-divider></v-divider>



			<v-card-text class="pa-4">



				<v-radio-group v-model="paymentType" inline class="mb-2">

					<v-radio label="Employee" value="employee" color="primary"></v-radio>

					<v-radio label="Autre" value="other" color="primary"></v-radio>

				</v-radio-group>



				<!-- Employee picker -->

				<v-autocomplete

					v-if="paymentType === 'employee'"

					v-model="selectedEmployee"

					:items="employees"

					item-title="employee_name"

					item-value="name"

					label="Select Employee *"

					variant="outlined"

					density="compact"

					class="mb-3"

					:loading="loadingEmployees"

					clearable

				></v-autocomplete>



				<!-- Supplier picker -->

				<v-autocomplete

					v-if="paymentType === 'other'"

					v-model="selectedSupplier"

					:items="suppliers"

					item-title="supplier_name"

					item-value="name"

					label="Select Supplier *"

					variant="outlined"

					density="compact"

					class="mb-3"

					:loading="loadingSuppliers"

					clearable

				></v-autocomplete>



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

					v-model.number="paidAmount"

					label="Amount *"

					variant="outlined"

					density="compact"

					type="number"

					prefix="DZD"

					class="mb-3"

					:rules="[v => !!v && v > 0 || 'Must be > 0']"

				></v-text-field>



				<!-- Remark -->

				<v-textarea

					v-model="remark"

					label="Remark"

					variant="outlined"

					density="compact"

					rows="2"

					placeholder="Enter payment details..."

					class="mb-1"

				></v-textarea>



			</v-card-text>



			<v-card-actions class="pa-4 pt-0">

				<v-btn color="grey" variant="text" @click="closeDialog">{{ __("Cancel") }}</v-btn>

				<v-spacer></v-spacer>

				<v-btn

					color="primary"

					variant="tonal"

					@click="processPayment"

					:loading="processing"

					:disabled="!canProcess"

				>

					{{ __("Process Payment") }}

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

			paymentType: 'employee',



			// Employee

			selectedEmployee: null,

			employees: [],

			loadingEmployees: false,



			// Supplier

			selectedSupplier: 'Autre',

			suppliers: [],

			loadingSuppliers: false,



			// Shared

			modeOfPayment: null,

			modesOfPayment: [],

			loadingModes: false,

			paidAmount: null,

			remark: '',

			processing: false,



			// Resolved at open time

			defaultCompany: null,

			defaultCurrency: null,

		};

	},



	computed: {

		canProcess() {

			if (!this.paidAmount || this.paidAmount <= 0) return false;

			if (!this.modeOfPayment) return false;

			if (this.paymentType === 'employee' && !this.selectedEmployee) return false;

			if (this.paymentType === 'other' && !this.selectedSupplier) return false;

			return true;

		}

	},



	watch: {

		paymentType(val) {

			if (val === 'employee') this.loadEmployees();

			if (val === 'other') this.loadSuppliers();

		}

	},



	methods: {

		async openDialog() {
			try {
				// Prevent multiple simultaneous openings
				if (this.dialog) {
					return;
				}
				
				this.dialog = true;
				
				// Load data in parallel for better performance
				await Promise.all([
					this.loadCompanyDefaults(),
					this.loadModesOfPayment(),
					this.loadEmployees()
				]);
				
			} catch (error) {
				console.error('Failed to open payment dialog:', error);
				this.$emit('show-message', { 
					title: 'Error', 
					text: 'Failed to open payment dialog. Please try again.', 
					color: 'error' 
				});
				// Close dialog on error
				this.dialog = false;
			}
		},



		closeDialog() {
			this.dialog = false;
			// Reset form after dialog closes to prevent visual glitches
			this.$nextTick(() => {
				this.resetForm();
			});
		},



		resetForm() {

			this.paymentType = 'employee';

			this.selectedEmployee = null;

			this.selectedSupplier = 'Autre';

			this.paidAmount = null;

			this.remark = '';

			this.modeOfPayment = null;

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

					args: { doctype: 'Mode of Payment', fields: ['name'], filters: { enabled: 1 , type: 'Cash'}, limit_page_length: 50 }

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



		// ── Employees ─────────────────────────────────────────────────────────

		async loadEmployees() {

			if (this.employees.length > 0) return;

			this.loadingEmployees = true;

			try {

				const r = await frappe.call({

					method: 'frappe.client.get_list',

					args: { doctype: 'Employee', fields: ['name', 'employee_name'], filters: { status: 'Active' }, limit_page_length: 500 }

				});

				this.employees = r.message || [];

			} catch (e) {

				console.error('loadEmployees failed:', e);

				this.$emit('show-message', { title: 'Error', text: 'Failed to load employees', color: 'error' });

			} finally {

				this.loadingEmployees = false;

			}

		},



		// ── Suppliers ─────────────────────────────────────────────────────────

		async loadSuppliers() {

			if (this.suppliers.length > 0) return;

			this.loadingSuppliers = true;

			try {

				const r = await frappe.call({

					method: 'frappe.client.get_list',

					args: { doctype: 'Supplier', fields: ['name', 'supplier_name'], filters: { disabled: 0 }, limit_page_length: 500 }

				});

				this.suppliers = r.message || [];

			} catch (e) {

				console.error('loadSuppliers failed:', e);

				this.$emit('show-message', { title: 'Error', text: 'Failed to load suppliers', color: 'error' });

			} finally {

				this.loadingSuppliers = false;

			}

		},



		// ── paid_from: from Mode of Payment ──────────────────────────────────

		async getPaidFromAccount() {

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

				console.warn('getPaidFromAccount failed:', e);

			}

			return null;

		},



		// ── paid_to: for Employee (payroll_payable_account) ───────────────────

		async getEmployeePaidToAccount(party) {

			try {

				const r = await frappe.call({

					method: 'frappe.client.get',

					args: { doctype: 'Employee', name: party }

				});

				if (r.message?.payroll_payable_account) return r.message.payroll_payable_account;

			} catch (_) {}

			return this.getCompanyPayableAccount();

		},



		// ── paid_to: for Supplier (default_payable_account) ───────────────────

		async getSupplierPaidToAccount(supplierName) {

			// Use frappe.client.get to avoid "Field not permitted in query" on default_payable_account

			try {

				const r = await frappe.call({

					method: 'frappe.client.get',

					args: { doctype: 'Supplier', name: supplierName }

				});

				if (r.message?.default_payable_account) return r.message.default_payable_account;

			} catch (_) {}

			return this.getCompanyPayableAccount();

		},



		// ── paid_to fallback: company default payable account ─────────────────

		async getCompanyPayableAccount() {

			try {

				const r = await frappe.call({

					method: 'frappe.client.get_value',

					args: { doctype: 'Company', filters: { name: this.defaultCompany }, fieldname: ['default_payable_account'] }

				});

				if (r.message?.default_payable_account) return r.message.default_payable_account;

			} catch (_) {}

			return null;

		},



		// ── Main ──────────────────────────────────────────────────────────────

		async processPayment() {

			if (!this.canProcess) return;

			this.processing = true;

			try {

				const paidFrom = await this.getPaidFromAccount();

				if (!paidFrom) {

					throw new Error(

						`No account configured for "${this.modeOfPayment}" → "${this.defaultCompany}". ` +

						`Go to Mode of Payment > ${this.modeOfPayment} > Accounts tab and add your company account.`

					);

				}



				if (this.paymentType === 'other') {

					const paidTo = await this.getSupplierPaidToAccount(this.selectedSupplier);

					if (!paidTo) throw new Error(`No payable account found for supplier "${this.selectedSupplier}".`);

					await this.createPaymentEntry('Supplier', this.selectedSupplier, paidFrom, paidTo);

				} else {

					const paidTo = await this.getEmployeePaidToAccount(this.selectedEmployee);

					if (!paidTo) throw new Error(`No payable account found for employee "${this.selectedEmployee}".`);

					await this.createPaymentEntry('Employee', this.selectedEmployee, paidFrom, paidTo);

				}

			} catch (error) {

				console.error('processPayment error:', error);

				this.$emit('show-message', { title: 'Payment Failed', text: error.message || 'Payment failed', color: 'error' });

			} finally {

				this.processing = false;

			}

		},



		// ── Payment Entry (shared for both Employee and Supplier) ─────────────

		async createPaymentEntry(partyType, party, paidFrom, paidTo) {
			// Get current POS opening shift
			const currentShift = this.getCurrentPosOpeningShift();
			
			const doc = {

				doctype: 'Payment Entry',

				payment_type: 'Pay',

				posting_date: frappe.datetime.nowdate(),

				company: this.defaultCompany,

				mode_of_payment: this.modeOfPayment,

				party_type: partyType,

				party: party,

				paid_from: paidFrom,

				paid_to: paidTo,

				// paid_from_account_currency: this.defaultCurrency,

				// paid_to_account_currency: this.defaultCurrency,

				paid_amount: parseFloat(this.paidAmount),

				received_amount: parseFloat(this.paidAmount),

				source_exchange_rate: 1,

				target_exchange_rate: 1,

				// Link to POS opening shift for analytics
				reference_no: currentShift?.name || '',
				reference_date: frappe.datetime.nowdate(),

				remarks: this.remark || `${partyType} Payment - ${party}`,

				custom_remark: this.remark || `${partyType} Payment - ${party}`,

			};



			const ins = await frappe.call({ method: 'frappe.client.insert', args: { doc } });

			if (!ins.message) throw new Error('Insert returned empty');

			await frappe.call({ method: 'frappe.client.submit', args: { doc: ins.message } });

			this.onSuccess(ins.message.name);

		},



		// ── Helper methods ─────────────────────────────────────────────────────

		getCurrentPosOpeningShift() {
			// Try to get from composable first
			if (this.pos_opening_shift?.value) {
				return this.pos_opening_shift.value;
			}
			
			// Try to get from storage as fallback using the correct storage method
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

			this.$emit('payment-success', { type: this.paymentType, amount: this.paidAmount, remark: this.remark, docname });

			this.$emit('show-message', { title: 'Success', text: `Payment of ${this.paidAmount} DZD processed — ${docname}`, color: 'success' });

			this.closeDialog();

		}

	}

};

</script>



<style scoped>

.v-dialog > .v-overlay__content {

	border-radius: 12px;

}

</style>

