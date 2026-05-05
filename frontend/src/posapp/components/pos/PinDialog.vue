<template>
	<v-dialog v-model="showPinDialog" persistent max-width="400px">
		<v-card>
			<v-card-title class="text-h6 pa-4 d-flex align-center">
				<v-icon class="mr-2" color="primary">mdi-lock</v-icon>
				{{ __("PIN Required") }}
			</v-card-title>
			
			<v-card-text class="pa-4">
				<v-form @submit.prevent="validatePin">
					<v-alert
						v-if="errorMessage"
						type="error"
						dense
						class="mb-3"
					>
						{{ errorMessage }}
					</v-alert>
					
					<div class="mb-3">
						<p class="text-body-2 mb-2">
							{{ __("Enter PIN code for") }} <strong>{{ selectedPosProfile }}</strong>
						</p>
					</div>
					
					<v-text-field
						v-model="pinCode"
						:label="__('PIN Code')"
						type="password"
						variant="outlined"
						density="compact"
						autocomplete="off"
						@keyup.enter="validatePin"
						:loading="validating"
						ref="pinInput"
						class="pin-input"
					>
						<template v-slot:prepend-inner>
							<v-icon color="grey">mdi-keyboard</v-icon>
						</template>
					</v-text-field>
					
					<!-- PIN Pad for touch screens -->
					<div class="pin-pad mt-3">
						<v-row dense>
							<v-col cols="4" v-for="num in [1,2,3,4,5,6,7,8,9]" :key="num">
								<v-btn
									@click="appendNumber(num)"
									variant="outlined"
									size="large"
									class="pin-btn"
									:disabled="validating"
								>
									{{ num }}
								</v-btn>
							</v-col>
							<v-col cols="4">
								<v-btn
									@click="appendNumber(0)"
									variant="outlined"
									size="large"
									class="pin-btn"
									:disabled="validating"
								>
									0
								</v-btn>
							</v-col>
							<v-col cols="4">
								<v-btn
									@click="clearPin"
									variant="outlined"
									color="error"
									size="large"
									class="pin-btn"
									:disabled="validating"
								>
									<v-icon>mdi-backspace</v-icon>
								</v-btn>
							</v-col>
							<v-col cols="4">
								<v-btn
									@click="validatePin"
									variant="elevated"
									color="primary"
									size="large"
									class="pin-btn"
									:loading="validating"
									:disabled="!pinCode || pinCode.length < 4"
								>
									<v-icon>mdi-check</v-icon>
								</v-btn>
							</v-col>
						</v-row>
					</div>
				</v-form>
			</v-card-text>
			
			<v-card-actions class="pa-4">
				<v-btn
					@click="cancelPin"
					variant="text"
					:disabled="validating"
				>
					{{ __("Cancel") }}
				</v-btn>
				<v-spacer></v-spacer>
				<v-btn
					@click="validatePin"
					color="primary"
					variant="elevated"
					:loading="validating"
					:disabled="!pinCode || pinCode.length < 4"
				>
					{{ __("Unlock") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script>
export default {
	name: 'PinDialog',
	props: {
		show: {
			type: Boolean,
			default: false
		},
		posProfile: {
			type: [String, Object],
			default: ''
		}
	},
	data() {
		return {
			pinCode: '',
			validating: false,
			errorMessage: '',
			showPinDialog: false,
			selectedPosProfile: ''
		};
	},
	watch: {
		show(val) {
			this.showPinDialog = val;
			if (val) {
				// Reset form when dialog opens
				this.resetForm();
				
				// Extract profile name from object or string
				if (typeof this.posProfile === 'object' && this.posProfile.name) {
					this.selectedPosProfile = this.posProfile.name;
				} else if (typeof this.posProfile === 'string') {
					this.selectedPosProfile = this.posProfile;
				} else {
					this.selectedPosProfile = '';
				}
				this.$nextTick(() => {
					this.$refs.pinInput?.focus();
				});
			}
		},
		showPinDialog(val) {
			if (!val) {
				this.$emit('update:show', false);
			}
		}
	},
	methods: {
		appendNumber(num) {
			if (this.pinCode.length < 6) {
				this.pinCode += num.toString();
				this.errorMessage = '';
			}
		},
		clearPin() {
			if (this.pinCode.length > 0) {
				this.pinCode = this.pinCode.slice(0, -1);
				this.errorMessage = '';
			}
		},
		resetForm() {
			this.pinCode = '';
			this.errorMessage = '';
			this.validating = false;
		},
		cancelPin() {
			this.$emit('cancelled');
			this.showPinDialog = false;
		},
		async validatePin() {
			if (!this.pinCode || this.pinCode.length < 4) {
				this.errorMessage = this.__('PIN must be at least 4 digits');
				return;
			}
			
			this.validating = true;
			this.errorMessage = '';
			
			try {
				const result = await frappe.call({
					method: 'posawesome.posawesome.api.shifts.validate_pos_pin',
					args: {
						pos_profile: this.selectedPosProfile,
						pin_code: this.pinCode
					}
				});
				
				if (result.message && result.message.valid) {
					this.$emit('validated', { pin_code: this.pinCode });
					this.showPinDialog = false;
				} else {
					this.errorMessage = this.__('Invalid PIN code');
					this.pinCode = '';
					this.$nextTick(() => {
						this.$refs.pinInput?.focus();
					});
				}
			} catch (error) {
				console.error('PIN validation error:', error);
				this.errorMessage = this.__('Error validating PIN');
			} finally {
				this.validating = false;
			}
		}
	}
};
</script>

<style scoped>
.pin-input {
	letter-spacing: 0.2em;
	text-align: center;
	font-size: 1.2em;
}

.pin-pad {
	max-width: 250px;
	margin: 0 auto;
}

.pin-btn {
	width: 100%;
	height: 50px !important;
	font-size: 1.1em;
	font-weight: bold;
}

.pin-btn:hover {
	transform: scale(1.05);
}
</style>
