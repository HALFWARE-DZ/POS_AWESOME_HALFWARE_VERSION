<template>
	<div class="pa-0">
		<v-card
			class="selection mx-auto pa-1 my-0 mt-3 pos-themed-card"
			style="max-height: 68vh; height: 68vh"
		>
			<v-progress-linear
				:active="loading"
				:indeterminate="loading"
				absolute
				location="top"
				color="info"
			></v-progress-linear>
			
			<!-- Filters Section -->
			<div class="pa-3 pb-0">
				<v-row dense>
					<v-col cols="12" md="3">
						<v-text-field
							v-model="filters.from_date"
							label="Date de début"
							type="date"
							variant="outlined"
							density="compact"
							hide-details
							@change="loadInvoices"
						></v-text-field>
					</v-col>
					<v-col cols="12" md="3">
						<v-text-field
							v-model="filters.to_date"
							label="Date de fin"
							type="date"
							variant="outlined"
							density="compact"
							hide-details
							@change="loadInvoices"
						></v-text-field>
					</v-col>
					<v-col cols="12" md="3">
						<v-text-field
							v-model="filters.customer"
							label="Client"
							variant="outlined"
							density="compact"
							hide-details
							clearable
							@keyup.enter="loadInvoices"
							@input="debouncedSearch"
						></v-text-field>
					</v-col>
					<v-col cols="12" md="3">
						<v-text-field
							v-model="filters.invoice_name"
							label="Facture #"
							variant="outlined"
							density="compact"
							hide-details
							clearable
							@keyup.enter="loadInvoices"
							@input="debouncedSearch"
						></v-text-field>
					</v-col>
				</v-row>
				<v-row dense class="mt-2">
					<v-col cols="12" md="2">
						<v-text-field
							v-model="filters.barcode"
							label="Code à barres"
							variant="outlined"
							density="compact"
							hide-details
							clearable
							@keyup.enter="loadInvoices"
							@input="debouncedSearch"
							prefix="mdi-barcode"
						></v-text-field>
					</v-col>
					<v-col cols="12" md="2">
						<v-text-field
							v-model="filters.item_code"
							label="Code article"
							variant="outlined"
							density="compact"
							hide-details
							clearable
							@keyup.enter="loadInvoices"
							@input="debouncedSearch"
							prefix="mdi-tag"
						></v-text-field>
					</v-col>
					<v-col cols="12" md="3">
						<v-select
							v-model="filters.status"
							:items="statusOptions"
							label="Statut"
							variant="outlined"
							density="compact"
							hide-details
							clearable
							@change="loadInvoices"
						></v-select>
					</v-col>
					<v-col cols="12" md="3">
						<v-btn
							block
							color="primary"
							variant="elevated"
							@click="loadInvoices"
							class="mt-1 search-btn"
							:loading="loading"
						>
							<v-icon left>mdi-magnify</v-icon>
							Rechercher
						</v-btn>
					</v-col>
					<v-col cols="12" md="3">
						<v-btn
							block
							color="grey"
							variant="tonal"
							@click="clearFilters"
							class="mt-1"
						>
							<v-icon left>mdi-refresh</v-icon>
							Effacer les filtres
						</v-btn>
					</v-col>
				</v-row>
			</div>

			<!-- Tabs for Invoices and Payment Entries -->
			<v-tabs v-model="activeTab" class="mb-4">
				<v-tab value="invoices">
					<v-icon left>mdi-receipt</v-icon>
					Factures de vente
				</v-tab>
				<v-tab value="payments">
					<v-icon left>mdi-cash-minus</v-icon>
					Paiements
				</v-tab>
			</v-tabs>

			<v-window v-model="activeTab">
				<!-- Invoices Tab -->
				<v-window-item value="invoices">
					<!-- Invoices List -->
					<div ref="historyContainer" class="overflow-y-auto pa-2" style="max-height: 40vh">
						<v-list v-if="invoices.length > 0" class="pa-0">
							<v-list-item
								v-for="invoice in invoices"
								:key="invoice.name"
								class="mb-2 history-item"
								@click="selectInvoice(invoice)"
								:class="{ 'selected-invoice': selectedInvoice?.name === invoice.name }"
							>
								<template v-slot:prepend>
									<v-avatar size="40" :color="getStatusColor(invoice.status)">
										<v-icon color="white">mdi-receipt</v-icon>
									</v-avatar>
								</template>
								
								<v-list-item-title class="font-weight-medium">
									<div class="d-flex align-center">
										<span>{{ invoice.name }}</span>
										<v-chip
											v-if="invoice.custom_is_reserve"
											:size="'x-small'"
											color="blue"
											class="ml-2"
										>
											Reservation
										</v-chip>
										<v-chip
											:size="'x-small'"
											:color="getStatusColor(invoice.status)"
											class="ml-2"
										>
											{{ invoice.status }}
										</v-chip>
									</div>
								</v-list-item-title>
								
								<v-list-item-subtitle>
									<div class="d-flex justify-space-between align-center">
										<span>{{ invoice.customer }}</span>
										<span class="font-weight-bold">{{ formatCurrency(invoice.grand_total) }}</span>
									</div>
									<div class="text-caption text-grey-600">
										{{ formatDate(invoice.posting_date) }}
									</div>
								</v-list-item-subtitle>
								
								<template v-slot:append>
									<v-btn
										icon="mdi-eye"
										variant="text"
										size="small"
										@click.stop="viewInvoice(invoice)"
									></v-btn>
								</template>
							</v-list-item>
						</v-list>
						
						<v-empty-state
							v-else-if="!loading"
							icon="mdi-receipt-text-outline"
							title="Aucune facture trouvée"
							text="Essayez d'ajuster vos filtres"
							class="my-8"
						></v-empty-state>
					</div>
				</v-window-item>

				<!-- Payment Entries Tab -->
				<v-window-item value="payments">
					<!-- Sub-tabs for payment types -->
					<v-tabs v-model="activePaymentTab" class="mb-2">
						<v-tab value="all">
							<v-icon left size="small">mdi-swap-horizontal</v-icon>
							Tous les paiements
						</v-tab>
						<v-tab value="incoming">
							<v-icon left size="small">mdi-cash-plus</v-icon>
							Entrants
						</v-tab>
						<v-tab value="outgoing">
							<v-icon left size="small">mdi-cash-minus</v-icon>
							Sortants
						</v-tab>
					</v-tabs>

					<v-window v-model="activePaymentTab">
						<!-- All Payments -->
						<v-window-item value="all">
							<div ref="paymentContainer" class="overflow-y-auto pa-2" style="max-height: 35vh">
								<v-list v-if="filteredPaymentEntries.length > 0" class="pa-0">
									<v-list-item
										v-for="payment in filteredPaymentEntries"
										:key="payment.name"
										class="mb-2 payment-item"
										@click="selectPayment(payment)"
										:class="{ 'selected-payment': selectedPayment?.name === payment.name }"
									>
										<template v-slot:prepend>
											<v-avatar size="40" :color="getPaymentColor(payment.party_type, payment.payment_type)">
												<v-icon color="white">
													{{ payment.payment_type === 'Receive' ? 'mdi-cash-plus' : 'mdi-cash-minus' }}
												</v-icon>
											</v-avatar>
										</template>
										
										<v-list-item-title class="font-weight-medium">
											<div class="d-flex align-center">
												<span>{{ payment.name }}</span>
												<v-chip
													:size="'x-small'"
													:color="getPaymentColor(payment.party_type, payment.payment_type)"
													class="ml-2"
												>
													{{ formatPaymentType(payment.party_type, payment.payment_type) }}
												</v-chip>
											</div>
										</v-list-item-title>
										
										<v-list-item-subtitle>
											<div class="d-flex justify-space-between align-center">
												<span>{{ payment.party }}</span>
												<span class="font-weight-bold" :class="payment.payment_type === 'Receive' ? 'success--text' : 'error--text'">
													{{ payment.payment_type === 'Receive' ? '+' : '-' }}{{ formatCurrency(payment.paid_amount) }}
												</span>
											</div>
											<div class="text-caption text-grey-600">
												{{ formatDate(payment.posting_date) }} · {{ payment.mode_of_payment }}
											</div>
										</v-list-item-subtitle>
										
										<template v-slot:append>
											<v-btn
												icon="mdi-eye"
												variant="text"
												size="small"
												@click.stop="selectPayment(payment)"
											></v-btn>
										</template>
									</v-list-item>
								</v-list>
								
								<v-empty-state
									v-else-if="!loading"
									icon="mdi-swap-horizontal"
									title="Aucune écriture de paiement trouvée"
									text="Aucune écriture de paiement enregistrée pour cette période"
									class="my-8"
								></v-empty-state>
							</div>
						</v-window-item>

						<!-- Incoming Payments Only -->
						<v-window-item value="incoming">
							<div ref="incomingContainer" class="overflow-y-auto pa-2" style="max-height: 35vh">
								<v-list v-if="incomingPayments.length > 0" class="pa-0">
									<v-list-item
										v-for="payment in incomingPayments"
										:key="payment.name"
										class="mb-2 payment-item"
										@click="selectPayment(payment)"
										:class="{ 'selected-payment': selectedPayment?.name === payment.name }"
									>
										<template v-slot:prepend>
											<v-avatar size="40" color="success">
												<v-icon color="white">mdi-cash-plus</v-icon>
											</v-avatar>
										</template>
										
										<v-list-item-title class="font-weight-medium">
											<div class="d-flex align-center">
												<span>{{ payment.name }}</span>
												<v-chip
													:size="'x-small'"
													color="success"
													class="ml-2"
												>
													Incoming
												</v-chip>
											</div>
										</v-list-item-title>
										
										<v-list-item-subtitle>
											<div class="d-flex justify-space-between align-center">
												<span>{{ payment.party }}</span>
												<span class="font-weight-bold success--text">
													+{{ formatCurrency(payment.paid_amount) }}
												</span>
											</div>
											<div class="text-caption text-grey-600">
												{{ formatDate(payment.posting_date) }} · {{ payment.mode_of_payment }}
											</div>
										</v-list-item-subtitle>
										
										<template v-slot:append>
											<v-btn
												icon="mdi-eye"
												variant="text"
												size="small"
												@click.stop="selectPayment(payment)"
											></v-btn>
										</template>
									</v-list-item>
								</v-list>
								
								<v-empty-state
									v-else-if="!loading"
									icon="mdi-cash-plus"
									title="Aucun paiement entrant trouvé"
									text="Aucun argent reçu pour cette période"
									class="my-8"
								></v-empty-state>
							</div>
						</v-window-item>

						<!-- Outgoing Payments Only -->
						<v-window-item value="outgoing">
							<div ref="outgoingContainer" class="overflow-y-auto pa-2" style="max-height: 35vh">
								<v-list v-if="outgoingPayments.length > 0" class="pa-0">
									<v-list-item
										v-for="payment in outgoingPayments"
										:key="payment.name"
										class="mb-2 payment-item"
										@click="selectPayment(payment)"
										:class="{ 'selected-payment': selectedPayment?.name === payment.name }"
									>
										<template v-slot:prepend>
											<v-avatar size="40" color="error">
												<v-icon color="white">mdi-cash-minus</v-icon>
											</v-avatar>
										</template>
										
										<v-list-item-title class="font-weight-medium">
											<div class="d-flex align-center">
												<span>{{ payment.name }}</span>
												<v-chip
													:size="'x-small'"
													color="error"
													class="ml-2"
												>
													Outgoing
												</v-chip>
											</div>
										</v-list-item-title>
										
										<v-list-item-subtitle>
											<div class="d-flex justify-space-between align-center">
												<span>{{ payment.party }}</span>
												<span class="font-weight-bold error--text">
													-{{ formatCurrency(payment.paid_amount) }}
												</span>
											</div>
											<div class="text-caption text-grey-600">
												{{ formatDate(payment.posting_date) }} · {{ payment.mode_of_payment }}
											</div>
										</v-list-item-subtitle>
										
										<template v-slot:append>
											<v-btn
												icon="mdi-eye"
												variant="text"
												size="small"
												@click.stop="selectPayment(payment)"
											></v-btn>
										</template>
									</v-list-item>
								</v-list>
								
								<v-empty-state
									v-else-if="!loading"
									icon="mdi-cash-minus"
									title="Aucun paiement sortant trouvé"
									text="Aucune dépense enregistrée pour cette période"
									class="my-8"
								></v-empty-state>
							</div>
						</v-window-item>
					</v-window>
				</v-window-item>
			</v-window>

			<!-- Summary Section -->
			<div v-if="(activeTab === 'invoices' && invoices.length > 0) || (activeTab === 'payments' && paymentEntries.length > 0)" class="pa-3 border-top">
				<v-card density="compact" color="grey-lighten-5" class="summary-card">
					<v-card-text class="pa-3">
						<!-- Invoices Summary -->
						<v-row dense align="center" v-if="activeTab === 'invoices'">
							<v-col cols="12" md="4">
								<div class="summary-item">
									<span class="summary-label">Total des factures:</span>
									<span class="summary-value font-weight-bold">{{ invoices.length }}</span>
								</div>
							</v-col>
							<v-col cols="12" md="4">
								<div class="summary-item">
									<span class="summary-label">Total général:</span>
									<span class="summary-value font-weight-bold primary--text">{{ formatCurrency(calculateGrandTotal()) }}</span>
								</div>
							</v-col>
							<v-col cols="12" md="4">
								<div class="summary-item">
									<span class="summary-label">Impayé:</span>
									<span class="summary-value font-weight-bold" :class="calculateOutstandingTotal() > 0 ? 'error--text' : 'success--text'">
										{{ formatCurrency(calculateOutstandingTotal()) }}
									</span>
								</div>
							</v-col>
						</v-row>
						
						<!-- Payment Entries Summary -->
						<v-row dense align="center" v-if="activeTab === 'payments'">
							<v-col cols="12" md="3">
								<div class="summary-item">
									<span class="summary-label">Paiements entrants:</span>
									<span class="summary-value font-weight-bold text-success">{{ incomingPayments.length }}</span>
								</div>
							</v-col>
							<v-col cols="12" md="3">
								<div class="summary-item">
									<span class="summary-label">Paiements sortants:</span>
									<span class="summary-value font-weight-bold text-error">{{ outgoingPayments.length }}</span>
								</div>
							</v-col>
							<v-col cols="12" md="3">
								<div class="summary-item">
									<span class="summary-label">Flux net:</span>
									<span class="summary-value font-weight-bold" :class="calculateNetPaymentFlow() >= 0 ? 'text-success' : 'text-error'">
										{{ calculateNetPaymentFlow() >= 0 ? '+' : '' }}{{ formatCurrency(calculateNetPaymentFlow()) }}
									</span>
								</div>
							</v-col>
							<v-col cols="12" md="3">
								<div class="summary-item">
									<span class="summary-label">Montant total:</span>
									<span class="summary-value font-weight-bold text-primary">{{ formatCurrency(calculateTotalPaymentsIn() + calculateTotalPaymentsOut()) }}</span>
								</div>
							</v-col>
						</v-row>
					</v-card-text>
				</v-card>
			</div>

			<!-- Invoice Details Dialog -->
		<v-dialog v-model="showDetailsDialog" max-width="800px" persistent>
			<v-card class="invoice-details-dialog">
				<v-card-title class="d-flex align-center pa-4">
					<v-icon class="mr-2" color="primary">mdi-receipt-text</v-icon>
					<span class="text-h6">Détails de la facture</span>
					<v-spacer></v-spacer>
					<v-btn
						icon="mdi-close"
						variant="text"
						@click="showDetailsDialog = false"
					></v-btn>
				</v-card-title>
				
				<v-divider></v-divider>
				
				<v-card-text class="pa-4" v-if="selectedInvoice">
					<v-row dense>
						<v-col cols="12" md="6">
							<div class="detail-section">
								<div class="section-header">
									<v-icon size="small" class="mr-1" color="primary">mdi-receipt</v-icon>
									<span class="section-title">Informations de base</span>
								</div>
								<div class="section-content">
									<div class="detail-row">
										<span class="detail-label">Facture #:</span>
										<span class="detail-value font-weight-medium">{{ selectedInvoice.name }}</span>
									</div>
									<div class="detail-row">
										<span class="detail-label">Date:</span>
										<span class="detail-value">{{ formatDate(selectedInvoice.posting_date) }}</span>
									</div>
									<div class="detail-row">
										<span class="detail-label">Statut:</span>
										<v-chip
											:size="x-small"
											:color="getStatusColor(selectedInvoice.status)"
											class="ml-2"
										>
											{{ selectedInvoice.status }}
										</v-chip>
									</div>
								</div>
							</div>
						</v-col>
						
						<v-col cols="12" md="6">
							<div class="detail-section">
								<div class="section-header">
									<v-icon size="small" class="mr-1" color="primary">mdi-account</v-icon>
									<span class="section-title">Informations client</span>
								</div>
								<div class="section-content">
									<div class="detail-row">
										<span class="detail-label">Client:</span>
										<span class="detail-value font-weight-medium">{{ selectedInvoice.customer }}</span>
									</div>
									<div v-if="selectedInvoice.custom_barcode" class="detail-row">
										<span class="detail-label">Code à barres:</span>
										<div class="d-flex align-center">
											<v-icon size="small" class="mr-1" color="grey">mdi-barcode</v-icon>
											<span class="detail-value font-weight-medium">{{ selectedInvoice.custom_barcode }}</span>
										</div>
									</div>
								</div>
							</div>
						</v-col>
						
						<v-col cols="12">
							<div class="detail-section">
								<div class="section-header">
									<v-icon size="small" class="mr-1" color="primary">mdi-currency</v-icon>
									<span class="section-title">Informations financières</span>
								</div>
								<div class="section-content">
									<div class="detail-row">
										<span class="detail-label">Montant total:</span>
										<span class="detail-value font-weight-bold primary--text text-h6">
											{{ formatCurrency(selectedInvoice.grand_total) }}
										</span>
									</div>
									<div v-if="selectedInvoice.outstanding_amount" class="detail-row">
										<span class="detail-label">Montant impayé:</span>
										<span class="detail-value font-weight-medium" :class="selectedInvoice.outstanding_amount > 0 ? 'error--text' : 'success--text'">
											{{ formatCurrency(selectedInvoice.outstanding_amount) }}
										</span>
									</div>
									<div class="detail-row">
										<span class="detail-label">Devise:</span>
										<span class="detail-value">{{ selectedInvoice.currency || 'DZD' }}</span>
									</div>
								</div>
							</div>
						</v-col>
						
						<v-col cols="12">
							<div class="detail-section">
								<div class="section-header">
									<v-icon size="small" class="mr-1" color="primary">mdi-cart</v-icon>
									<span class="section-title">Détails de la facture</span>
								</div>
								<div class="section-content">
									<!-- Loading -->
									<div v-if="currentItemsLoading" class="text-center py-4">
										<v-progress-circular indeterminate color="primary" size="28"></v-progress-circular>
										<div class="mt-2 text-caption" style="color:#888;">Chargement des articles...</div>
										<div class="mt-2 text-caption" style="color:#888;">Chargement des articles...</div>
									</div>
									<!-- Items table -->
									<table v-else-if="currentItemsReady" style="width:100%; border-collapse:collapse;">
										<thead>
											<tr>
												<th style="text-align:left; padding:8px 10px; background:#f5f5f5; border-bottom:2px solid #ddd; font-size:0.8rem; color:#555;">Article</th>
												<th style="text-align:center; padding:8px 10px; background:#f5f5f5; border-bottom:2px solid #ddd; font-size:0.8rem; color:#555;">Qté</th>
												<th style="text-align:right; padding:8px 10px; background:#f5f5f5; border-bottom:2px solid #ddd; font-size:0.8rem; color:#555;">Prix</th>
												<th style="text-align:right; padding:8px 10px; background:#f5f5f5; border-bottom:2px solid #ddd; font-size:0.8rem; color:#555;">Remise</th>
												<th style="text-align:right; padding:8px 10px; background:#f5f5f5; border-bottom:2px solid #ddd; font-size:0.8rem; color:#555;">Remise distribuée</th>
												<th style="text-align:right; padding:8px 10px; background:#f5f5f5; border-bottom:2px solid #ddd; font-size:0.8rem; color:#555;">Montant net</th>
											</tr>
										</thead>
										<tbody>
											<tr v-for="item in currentItems" :key="item.name" style="border-bottom:1px solid #f0f0f0;">
												<td style="padding:8px 10px;">
													<div style="font-weight:500; color:#333; font-size:0.875rem;">{{ parseVariantInfo(item.item_name, item.item_code).baseName }}</div>
													<div style="font-size:0.72rem; color:#666; margin-top:2px;">
														<span v-if="parseVariantInfo(item.item_name, item.item_code).color" style="margin-right:8px;">
															<strong>Couleur:</strong> {{ parseVariantInfo(item.item_name, item.item_code).color }}
														</span>
														<span v-if="parseVariantInfo(item.item_name, item.item_code).size">
															<strong>Taille:</strong> {{ parseVariantInfo(item.item_name, item.item_code).size }}
														</span>
													</div>
													<div style="font-size:0.72rem; color:#999; margin-top:2px;">{{ item.item_code || item.name || '' }}</div>
												</td>
												<td style="padding:8px 10px; text-align:center; font-size:0.875rem;">{{ item.qty || 0 }}</td>
												<td style="padding:8px 10px; text-align:right; font-size:0.875rem;">{{ formatCurrency(item.price_list_rate || item.rate || 0) }}</td>
												<td style="padding:8px 10px; text-align:right; font-size:0.875rem;">
													<span v-if="(item.discount_percentage || 0) > 0" style="color:#e53935;">
														-{{ item.discount_percentage }}%<br>
														<small>-{{ formatCurrency((item.discount_amount || 0) * Math.abs(item.qty || 1)) }}</small>
													</span>
													<span v-else-if="(item.discount_amount || 0) > 0" style="color:#e53935;">
														-{{ formatCurrency((item.discount_amount || 0) * Math.abs(item.qty || 1)) }}
													</span>
													<span v-else style="color:#bbb;">—</span>
												</td>
												<td style="padding:8px 10px; text-align:right; font-size:0.875rem;">
													<span v-if="(item.distributed_discount_amount || 0) > 0" style="color:#ff6b35;">-{{ formatCurrency(item.distributed_discount_amount) }}</span>
													<span v-else style="color:#bbb;">—</span>
												</td>
												<td style="padding:8px 10px; text-align:right; font-weight:600; font-size:0.875rem; color:#2e7d32;">{{ formatCurrency(item.net_amount || 0) }}</td>
											</tr>
										</tbody>
										<tfoot>
											<tr style="border-top:2px solid #ddd; background:#fafafa;">
												<td colspan="3" style="padding:10px; text-align:right; font-weight:600; color:#555; font-size:0.875rem;">Total Remise:</td>
												<td style="padding:10px; text-align:right; font-weight:700; color:#e53935; font-size:0.875rem;">
													-{{ formatCurrency(currentItems.reduce((s, i) => s + (i.discount_amount || 0) * Math.abs(i.qty || 1), 0)) }}
												</td>
												<td colspan="2" style="padding:10px; text-align:right; font-weight:700; color:#009688; font-size:1rem;">
													{{ formatCurrency(selectedInvoice.grand_total) }}
												</td>
											</tr>
										</tfoot>
									</table>
									<!-- Empty -->
									<div v-else class="text-center py-4" style="color:#aaa;">
										<v-icon size="large" color="grey">mdi-cart-off</v-icon>
										<div class="mt-2">Aucun article trouvé pour cette facture</div>
									</div>
								</div>
							</div>
						</v-col>
					</v-row>
				</v-card-text>
				
				<v-divider></v-divider>
				
				<v-card-actions class="pa-4">
					<v-btn
						color="primary"
						variant="elevated"
						@click="printInvoice(selectedInvoice)"
						class="action-btn"
					>
						<v-icon left>mdi-printer</v-icon>
						Imprimer la facture
					</v-btn>
					<v-spacer></v-spacer>
					<!-- <v-btn
						color="success"
						variant="elevated"
						@click="newSaleFromInvoice(selectedInvoice)"
						class="action-btn"
					>
						<v-icon left>mdi-plus</v-icon>
						New Sale
					</v-btn> -->
					<v-btn
						color="info"
						variant="outlined"
						@click="viewInvoice(selectedInvoice)"
						class="action-btn"
					>
						<v-icon left>mdi-eye</v-icon>
						View Full
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<!-- Payment Details Dialog -->
		<v-dialog v-model="showPaymentDetailsDialog" max-width="600px" persistent>
			<v-card class="payment-details-dialog">
				<v-card-title class="d-flex align-center pa-4">
					<v-icon class="mr-2" color="error">mdi-cash-minus</v-icon>
					<span class="text-h6">Payment Entry Details</span>
					<v-spacer></v-spacer>
					<v-btn
						icon="mdi-close"
						variant="text"
						@click="showPaymentDetailsDialog = false"
					></v-btn>
				</v-card-title>
				
				<v-divider></v-divider>
				
				<v-card-text class="pa-4" v-if="selectedPayment">
					<v-row dense>
						<v-col cols="12" md="6">
							<div class="detail-section">
								<div class="section-header">
									<v-icon size="small" class="mr-1" :color="selectedPayment.payment_type === 'Receive' ? 'success' : 'error'">
										{{ selectedPayment.payment_type === 'Receive' ? 'mdi-cash-plus' : 'mdi-cash-minus' }}
									</v-icon>
									<span class="section-title">Payment Information</span>
								</div>
								<div class="section-content">
									<div class="detail-row">
										<span class="detail-label">Payment #:</span>
										<span class="detail-value font-weight-medium">{{ selectedPayment.name }}</span>
									</div>
									<div class="detail-row">
										<span class="detail-label">Date:</span>
										<span class="detail-value">{{ formatDate(selectedPayment.posting_date) }}</span>
									</div>
									<div class="detail-row">
										<span class="detail-label">Payment Type:</span>
										<v-chip
											:size="x-small"
											:color="selectedPayment.payment_type === 'Receive' ? 'success' : 'error'"
											class="ml-2"
										>
											{{ selectedPayment.payment_type === 'Receive' ? 'Incoming' : 'Outgoing' }}
										</v-chip>
									</div>
								</div>
							</div>
						</v-col>
						
						<v-col cols="12" md="6">
							<div class="detail-section">
								<div class="section-header">
									<v-icon size="small" class="mr-1" color="primary">mdi-account</v-icon>
									<span class="section-title">Party Information</span>
								</div>
								<div class="section-content">
									<div class="detail-row">
										<span class="detail-label">Party Type:</span>
										<span class="detail-value font-weight-medium">{{ selectedPayment.party_type }}</span>
									</div>
									<div class="detail-row">
										<span class="detail-label">Party:</span>
										<span class="detail-value font-weight-medium">{{ selectedPayment.party }}</span>
									</div>
								</div>
							</div>
						</v-col>
						
						<v-col cols="12">
							<div class="detail-section">
								<div class="section-header">
									<v-icon size="small" class="mr-1" color="primary">mdi-currency</v-icon>
									<span class="section-title">Financial Information</span>
								</div>
								<div class="section-content">
									<div class="detail-row">
										<span class="detail-label">Amount:</span>
										<span class="detail-value font-weight-bold text-h6" :class="selectedPayment.payment_type === 'Receive' ? 'success--text' : 'error--text'">
											{{ selectedPayment.payment_type === 'Receive' ? '+' : '-' }}{{ formatCurrency(selectedPayment.paid_amount) }}
										</span>
									</div>
									<div class="detail-row">
										<span class="detail-label">Mode of Payment:</span>
										<span class="detail-value font-weight-medium">{{ selectedPayment.mode_of_payment }}</span>
									</div>
								</div>
							</div>
						</v-col>
						
						<v-col cols="12" v-if="selectedPayment.remarks || selectedPayment.custom_remark">
							<div class="detail-section">
								<div class="section-header">
									<v-icon size="small" class="mr-1" color="primary">mdi-text</v-icon>
									<span class="section-title">Remarks</span>
								</div>
								<div class="section-content">
									<div class="detail-row">
										<span class="detail-value">{{ selectedPayment.custom_remark || selectedPayment.remarks || 'No remarks' }}</span>
									</div>
								</div>
							</div>
						</v-col>
					</v-row>
				</v-card-text>
				
				<v-divider></v-divider>
				
				<v-card-actions class="pa-4">
					<v-btn
						color="info"
						variant="outlined"
						@click="viewPaymentEntry(selectedPayment)"
						class="action-btn"
					>
						<v-icon left>mdi-eye</v-icon>
						View Full
					</v-btn>
					<v-spacer></v-spacer>
					<v-btn
						color="grey"
						variant="text"
						@click="showPaymentDetailsDialog = false"
					>
						Close
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
			<!-- Summary Bottom Bar -->
			<v-divider></v-divider>
			<div class="summary-bar pa-3">
				<!-- Invoices Summary Bar -->
				<v-row dense align="center" v-if="activeTab === 'invoices'">
					<v-col cols="12" md="4" class="d-flex align-center">
						<v-icon size="small" color="grey-darken-1" class="mr-1">mdi-receipt-text</v-icon>
						<span class="text-body-2 text-grey-darken-1 mr-1">Total Invoices:</span>
						<span class="font-weight-bold text-body-2">{{ totalInvoices }}</span>
					</v-col>
					<v-col cols="12" md="4" class="d-flex align-center">
						<v-icon size="small" color="teal" class="mr-1">mdi-cash-check</v-icon>
						<span class="text-body-2 text-grey-darken-1 mr-1">Paid Invoices:</span>
						<span class="font-weight-bold text-body-2 text-teal">{{ paidCount }}</span>
					</v-col>
					<v-col cols="12" md="4" class="d-flex align-center justify-md-end">
						<v-icon size="small" color="green" class="mr-1">mdi-currency-usd</v-icon>
						<span class="text-body-2 text-grey-darken-1 mr-1">Total Received (Paid + Partial):</span>
						<span class="font-weight-bold text-body-1 text-green">{{ formatCurrency(paidTotal) }}</span>
					</v-col>
				</v-row>
				
				<!-- Payment Entries Summary Bar -->
				<v-row dense align="center" v-if="activeTab === 'payments'">
					<v-col cols="12" md="3" class="d-flex align-center">
						<v-icon size="small" color="success" class="mr-1">mdi-cash-plus</v-icon>
						<span class="text-body-2 text-grey-darken-1 mr-1">Incoming:</span>
						<span class="font-weight-bold text-body-2 text-success">{{ incomingPayments.length }}</span>
					</v-col>
					<v-col cols="12" md="3" class="d-flex align-center">
						<v-icon size="small" color="error" class="mr-1">mdi-cash-minus</v-icon>
						<span class="text-body-2 text-grey-darken-1 mr-1">Outgoing:</span>
						<span class="font-weight-bold text-body-2 text-error">{{ outgoingPayments.length }}</span>
					</v-col>
					<v-col cols="12" md="3" class="d-flex align-center">
						<v-icon size="small" color="blue" class="mr-1">mdi-swap-horizontal</v-icon>
						<span class="text-body-2 text-grey-darken-1 mr-1">Net Flow:</span>
						<span class="font-weight-bold text-body-2" :class="calculateNetPaymentFlow() >= 0 ? 'text-success' : 'text-error'">
							{{ calculateNetPaymentFlow() >= 0 ? '+' : '' }}{{ formatCurrency(calculateNetPaymentFlow()) }}
						</span>
					</v-col>
					<v-col cols="12" md="3" class="d-flex align-center justify-md-end">
						<v-icon size="small" color="primary" class="mr-1">mdi-cash-multiple</v-icon>
						<span class="text-body-2 text-grey-darken-1 mr-1">Total:</span>
						<span class="font-weight-bold text-body-1 text-primary">{{ paymentEntries.length }}</span>
					</v-col>
				</v-row>
			</div>

		</v-card>
	</div>
</template>

<script>
/* global frappe */
import { getCurrentInstance } from 'vue';
import { usePosShift } from '../../composables/usePosShift.js';
import { getOpeningStorage } from '../../../offline/index.js';

export default {
	data() {
		return {
			loading: false,
			invoices: [],
			paymentEntries: [], // New array for payment entries
			invoiceItems: {}, // Reactive map for invoice items
			selectedInvoice: null,
			selectedPayment: null, // New selected payment
			showDetailsDialog: false,
			showPaymentDetailsDialog: false, // New dialog for payment details
			activeTab: 'invoices', // New active tab property
			activePaymentTab: 'all', // New active payment tab property
			filters: {
				from_date: '',
				to_date: '',
				customer: '',
				invoice_name: '',
				barcode: '',
				item_code: '',
				status: ''
			},
			statusOptions: [
				{ title: 'Paid', value: 'Paid' },
				{ title: 'Partly Paid', value: 'Partly Paid' },
				{ title: 'Unpaid', value: 'Unpaid' },
				{ title: 'Overdue', value: 'Overdue' },
				{ title: 'Draft', value: 'Draft' },
			],
			searchTimeout: null,
			eventBus: null
		};
	},

	mounted() {
		const instance = getCurrentInstance();
		this.eventBus = instance?.proxy?.eventBus || instance?.appContext?.config?.globalProperties?.$eventBus;
		this.setDefaultDates();
		this.loadInvoices();
		this.loadPaymentEntries(); // Load payment entries
	},

	computed: {
		// Computed properties for payment filtering
		filteredPaymentEntries() {
			return this.paymentEntries;
		},
		
		incomingPayments() {
			return this.paymentEntries.filter(payment => payment.payment_type === 'Receive');
		},
		
		outgoingPayments() {
			return this.paymentEntries.filter(payment => payment.payment_type === 'Pay');
		},
		
		totalInvoices() {
			return this.invoices.length;
		},
		paidCount() {
			return this.invoices.filter(inv => inv.status === 'Paid').length;
		},
		paidTotal() {
			return this.invoices
				.filter(inv => inv.status === 'Paid' || inv.status === 'Partly Paid')
				.reduce((sum, inv) => sum + (inv.paid_amount || 0), 0);
		},
		currentItems() {
			if (!this.selectedInvoice) return undefined;
			return this.invoiceItems[this.selectedInvoice.name];
		},
		currentItemsLoading() {
			return this.currentItems === null;
		},
		currentItemsReady() {
			return Array.isArray(this.currentItems) && this.currentItems.length > 0;
		}
	},

	methods: {
		setDefaultDates() {
			const today = new Date();
			const thirtyDaysAgo = new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000));
			
			this.filters.from_date = thirtyDaysAgo.toISOString().split('T')[0];
			this.filters.to_date = today.toISOString().split('T')[0];
		},

		async loadInvoices() {
			this.loading = true;
			this.invoiceItems = {}; // reset items cache on each new search
			try {
				const filters = this.buildFilters();
				
				// Removed POS profile and opening shift filters to show all invoices
				// const posData = this.getCurrentPosData();
				// if (posData.pos_profile) {
				// 	filters.push(['pos_profile', '=', posData.pos_profile]);
				// }
				// if (posData.pos_opening_shift) {
				// 	filters.push(['posa_pos_opening_shift', '=', posData.pos_opening_shift]);
				// }
				
				// If searching by barcode or item code, we need to search in invoice items too
				let invoices = [];
				let itemInvoices = [];
				
				if (this.filters.barcode) {
					// First get invoices matching barcode in custom_barcode field
					const result1 = await frappe.call({
						method: 'frappe.client.get_list',
						args: {
							doctype: 'Sales Invoice',
							fields: [
								'name', 'customer', 'posting_date', 'grand_total',
								'status', 'remarks', 'currency', 'outstanding_amount', 'custom_barcode', 'custom_is_reserve',
								'creation', 'modified', 'pos_profile', 'posa_pos_opening_shift'
							],
							filters: [...filters, ['custom_barcode', 'like', `%${this.filters.barcode}%`], ['docstatus', '=', 1]],
							order_by: 'posting_date desc, creation desc',
							limit_page_length: 200
						}
					});
					invoices = result1.message || [];
					
					// Get invoices that contain items with the barcode using Python function
					const itemInvoicesResult = await frappe.call({
						method: 'posawesome.api.get_invoices_by_item_barcode',
						args: {
							barcode: this.filters.barcode
						}
					});
					
					console.log('Item invoices from Python (barcode):', itemInvoicesResult.message?.length || 0);
					itemInvoices = itemInvoicesResult.message || [];
				}
				
				if (this.filters.item_code) {
					// Get invoices that contain items with the item code using Python function
					const itemCodeInvoicesResult = await frappe.call({
						method: 'posawesome.api.get_invoices_by_item_code',
						args: {
							item_code: this.filters.item_code
						}
					});
					
					console.log('Item invoices from Python (item code):', itemCodeInvoicesResult.message?.length || 0);
					const itemCodeInvoices = itemCodeInvoicesResult.message || [];
					itemInvoices = [...itemInvoices, ...itemCodeInvoices];
				}
				
				// If we have barcode or item code search, merge results and remove duplicates
				if (this.filters.barcode || this.filters.item_code) {
					const allInvoices = [...invoices, ...itemInvoices];
					const uniqueInvoices = allInvoices.filter((invoice, index, self) => 
						index === self.findIndex((inv) => inv.name === invoice.name)
					);
					invoices = uniqueInvoices;
					console.log('Final merged invoices count:', invoices.length);
				} else {
					// Normal search without barcode
					const result = await frappe.call({
						method: 'frappe.client.get_list',
						args: {
							doctype: 'Sales Invoice',
							fields: [
								'name', 'customer', 'posting_date', 'grand_total',
								'status', 'remarks', 'currency', 'outstanding_amount', 'custom_barcode', 'custom_is_reserve',
								'creation', 'modified', 'pos_profile', 'posa_pos_opening_shift'
							],
							filters: filters,
							order_by: 'posting_date desc, creation desc',
							limit_page_length: 200
						}
					});
					invoices = result.message || [];
				}

				this.invoices = invoices;
				
				// Additional client-side sorting to ensure recent items are at top
				this.invoices.sort((a, b) => {
					// First sort by posting date (newest first)
					const dateA = new Date(a.posting_date || a.creation);
					const dateB = new Date(b.posting_date || b.creation);
					if (dateB.getTime() !== dateA.getTime()) {
						return dateB.getTime() - dateA.getTime();
					}
					// If same date, sort by creation time (newest first)
					const timeA = new Date(a.creation);
					const timeB = new Date(b.creation);
					return timeB.getTime() - timeA.getTime();
				});
			} catch (error) {
				console.error('Failed to load invoices:', error);
				if (this.eventBus) {
					this.eventBus.emit('show_message', {
						title: 'Error',
						text: 'Failed to load invoices',
						color: 'error'
					});
				}
			} finally {
				this.loading = false;
			}
		},

		// New method to load payment entries
		async loadPaymentEntries() {
			try {
				const posData = this.getCurrentPosData();
				const filters = [];
				
				// Filter by date range
				if (this.filters.from_date) {
					filters.push(['posting_date', '>=', this.filters.from_date]);
				}
				if (this.filters.to_date) {
					filters.push(['posting_date', '<=', this.filters.to_date]);
				}
				
				// Get both incoming (Receive) and outgoing (Pay) payments
				filters.push(['payment_type', 'in', ['Pay', 'Receive']]);
				filters.push(['docstatus', '=', 1]); // Only submitted payments
				
				const result = await frappe.call({
					method: 'frappe.client.get_list',
					args: {
						doctype: 'Payment Entry',
						fields: [
							'name', 'party_type', 'party', 'posting_date', 'paid_amount',
							'mode_of_payment', 'remarks', 'custom_remark', 'reference_no',
							'creation', 'modified', 'payment_type'
						],
						filters: filters,
						order_by: 'posting_date desc, creation desc',
						limit_page_length: 200
					}
				});

				this.paymentEntries = result.message || [];
			} catch (error) {
				console.error('Failed to load payment entries:', error);
				this.paymentEntries = [];
			}
		},

		// New method to get current POS data
		getCurrentPosData() {
			// Try to get from composable first
			const { pos_profile, pos_opening_shift } = usePosShift();
			
			let posProfile = pos_profile?.value;
			let posOpeningShift = pos_opening_shift?.value;
			
			// Fallback to storage
			if (!posProfile || !posOpeningShift) {
				try {
					const storageData = getOpeningStorage();
					if (storageData) {
						posProfile = posProfile || storageData.pos_profile;
						posOpeningShift = posOpeningShift || storageData.pos_opening_shift;
					}
				} catch (e) {
					console.warn('Failed to get POS data from storage:', e);
				}
			}
			
			return {
				pos_profile: posProfile?.name || posProfile,
				pos_opening_shift: posOpeningShift?.name || posOpeningShift
			};
		},

		parseVariantInfo(itemName, itemCode) {
			if (!itemName) return { baseName: 'Unknown Item', size: '', color: '' };
			
			// Try to parse from item_name (format: "BaseName-Color-Size")
			let parts = itemName.split('-');
			if (parts.length >= 3) {
				return {
					baseName: parts[0] || itemName,
					color: parts[1] || '',
					size: parts[2] || ''
				};
			}
			
			// Fallback: try to parse from item_code if it has variant info
			if (itemCode && itemCode.includes('-')) {
				let codeParts = itemCode.split('-');
				if (codeParts.length >= 3) {
					return {
						baseName: itemName,
						color: codeParts[1] || '',
						size: codeParts[2] || ''
					};
				}
			}
			
			// If no variant pattern found, return the whole name as base
			return {
				baseName: itemName,
				color: '',
				size: ''
			};
		},

		debugItems(items, invoiceName) {
			console.log(`🐛 Debug items for ${invoiceName}:`, items);
			if (items && items.length > 0) {
				items.forEach((item, index) => {
					console.log(`🐛 Item ${index} - ALL FIELDS:`, item);
					console.log(`🐛 Item ${index} - KEYS:`, Object.keys(item));
					console.log(`🐛 Item ${index} - Common fields:`, {
						name: item.name,
						item_code: item.item_code,
						item_name: item.item_name,
						qty: item.qty,
						rate: item.rate,
						price: item.price,
						amount: item.amount,
						total: item.total,
						discount_amount: item.discount_amount
					});
				});
			}
		},

		async loadItemsForInvoice(invoiceName) {
			// Already loaded (even if empty array) — skip
			if (this.invoiceItems[invoiceName] !== undefined) return;

			console.log('🔍 Starting to load items for invoice:', invoiceName);
			this.invoiceItems = { ...this.invoiceItems, [invoiceName]: null };

			try {
				// Strategy 1: Try get_doc first since get_list is not returning item fields
				console.log('🔍 Trying Strategy 1: get_doc for Sales Invoice');
				const docResult = await frappe.call({
					method: 'frappe.client.get',
					args: { doctype: 'Sales Invoice', name: invoiceName }
				});
				
				console.log('🔍 Strategy 1 result:', docResult);
				let items = (docResult.message && docResult.message.items) || [];
				console.log('🔍 Strategy 1 items count:', items.length);
				
				// Log the first item from get_doc
				if (items.length > 0) {
					console.log('🔍 Strategy 1 first item structure:', items[0]);
					console.log('🔍 Strategy 1 first item keys:', Object.keys(items[0]));
				}

				// Strategy 2: if get_doc returned nothing, try get_list
				if (items.length === 0) {
					console.log('🔍 Strategy 1 returned empty, trying Strategy 2: get_list on Sales Invoice Item');
					const listResult = await frappe.call({
						method: 'frappe.client.get_list',
						args: {
							doctype: 'Sales Invoice Item',
							filters: [
								['parent', '=', invoiceName],
								['parenttype', '=', 'Sales Invoice']
							],
							fields: [
								'*'  // Get all fields to see what's available
							],
							order_by: 'idx asc',
							limit_page_length: 500
						}
					});

					console.log('🔍 Strategy 2 result:', listResult);
					items = listResult.message || [];
					console.log('🔍 Strategy 2 items count:', items.length);

					// Log the first item to see its structure
					if (items.length > 0) {
						console.log('🔍 Strategy 2 first item structure:', items[0]);
						console.log('🔍 Strategy 2 first item keys:', Object.keys(items[0]));
					}
				}

				console.log('🔍 Final items to set:', items);
				this.debugItems(items, invoiceName);
				this.invoiceItems = { ...this.invoiceItems, [invoiceName]: items };
				console.log('🔍 Updated invoiceItems:', this.invoiceItems);
			} catch (error) {
				console.error('❌ Failed to load items for', invoiceName, error);
				// Last resort: try get_list directly
				try {
					console.log('🔍 Last resort: get_list');
					const listResult = await frappe.call({
						method: 'frappe.client.get_list',
						args: {
							doctype: 'Sales Invoice Item',
							filters: [
								['parent', '=', invoiceName],
								['parenttype', '=', 'Sales Invoice']
							],
							fields: ['*'],
							order_by: 'idx asc',
							limit_page_length: 500
						}
					});
					const items = listResult.message || [];
					console.log('🔍 Last resort items count:', items.length);
					if (items.length > 0) {
						console.log('🔍 Last resort first item structure:', items[0]);
						console.log('🔍 Last resort first item keys:', Object.keys(items[0]));
					}
					this.debugItems(items, invoiceName);
					this.invoiceItems = { ...this.invoiceItems, [invoiceName]: items };
				} catch (e) {
					console.error('❌ Last resort failed:', e);
					this.invoiceItems = { ...this.invoiceItems, [invoiceName]: [] };
				}
			}
		},

		buildFilters() {
			const filters = [];
			
			if (this.filters.from_date) {
				filters.push(['posting_date', '>=', this.filters.from_date]);
			}
			
			if (this.filters.to_date) {
				filters.push(['posting_date', '<=', this.filters.to_date]);
			}
			
			if (this.filters.customer) {
				filters.push(['customer', 'like', `%${this.filters.customer}%`]);
			}
			
			if (this.filters.invoice_name) {
				filters.push(['name', 'like', `%${this.filters.invoice_name}%`]);
			}
			
			// Barcode filter is handled separately in loadInvoices for better search functionality
			
			if (this.filters.status) {
				filters.push(['status', '=', this.filters.status]);
			}
			
			// Only show sales invoices (not returns) and only submitted invoices (not drafts)
			filters.push(['is_return', '=', 0]);
			filters.push(['docstatus', '=', 1]); // Only submitted invoices
			
			return filters;
		},

		debouncedSearch() {
			clearTimeout(this.searchTimeout);
			this.searchTimeout = setTimeout(() => {
				this.loadInvoices();
			}, 300);
		},

		clearFilters() {
			this.filters = {
				from_date: '',
				to_date: '',
				customer: '',
				invoice_name: '',
				barcode: '',
				item_code: '',
				status: ''
			};
			this.setDefaultDates();
			this.loadInvoices();
			this.loadPaymentEntries(); // Reload payment entries
		},

		selectInvoice(invoice) {
			this.selectedInvoice = invoice;
			this.showDetailsDialog = true;
			// Lazy-load items only when popup opens
			this.loadItemsForInvoice(invoice.name);
		},

		// New method to select payment entry
		selectPayment(payment) {
			this.selectedPayment = payment;
			this.showPaymentDetailsDialog = true;
		},

		viewInvoice(invoice) {
			// Open invoice in new tab or modal
			const url = `/app/sales-invoice/${invoice.name}`;
			window.open(url, '_blank');
		},

		printInvoice(invoice) {
			// Trigger print functionality
			const url = `/printview?doctype=Sales%20Invoice&name=${invoice.name}&format=Bon de caisse&trigger_print=1`;
			window.open(url, '_blank');
		},

		// New method to view payment entry
		viewPaymentEntry(payment) {
			// Open payment entry in new tab or modal
			const url = `/app/payment-entry/${payment.name}`;
			window.open(url, '_blank');
		},

		// newSaleFromInvoice(invoice) {
		// 	// Create new sale with same customer
		// 	this.eventBus.emit('new-sale-with-customer', invoice.customer);
		// },

		formatCurrency(amount) {
			if (!amount) return '0';
			try {
				return new Intl.NumberFormat('fr-DZ', {
					style: 'currency',
					currency: 'DZD'
				}).format(amount);
			} catch (error) {
				// Fallback to simple formatting if locale fails
				return new Intl.NumberFormat('fr-FR', {
					style: 'currency',
					currency: 'DZD'
				}).format(amount);
			}
		},

		formatDate(dateString) {
			if (!dateString) return '';
			const date = new Date(dateString);
			return date.toLocaleDateString('fr-FR', {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric'
			});
		},

		getStatusColor(status) {
			const colors = {
				'Paid': 'green',
				'Partially Paid': 'purple',
				'Unpaid': 'orange',
				'Overdue': 'red',
				'Draft': 'grey'
			};
			return colors[status] || 'grey';
		},

		calculateGrandTotal() {
			return this.invoices.reduce((total, invoice) => {
				return total + (invoice.grand_total || 0);
			}, 0);
		},

		calculateOutstandingTotal() {
			return this.invoices.reduce((total, invoice) => {
				return total + (invoice.outstanding_amount || 0);
			}, 0);
		},

		// New method to calculate total payments out
		calculateTotalPaymentsOut() {
			return this.outgoingPayments.reduce((total, payment) => {
				return total + (payment.paid_amount || 0);
			}, 0);
		},

		// New method to calculate total payments in
		calculateTotalPaymentsIn() {
			return this.incomingPayments.reduce((total, payment) => {
				return total + (payment.paid_amount || 0);
			}, 0);
		},

		// New method to calculate net payment flow (incoming - outgoing)
		calculateNetPaymentFlow() {
			return this.calculateTotalPaymentsIn() - this.calculateTotalPaymentsOut();
		},

		// New method to format payment type
		formatPaymentType(partyType, paymentType) {
			if (paymentType === 'Receive') {
				return 'Incoming Payment';
			} else if (paymentType === 'Pay') {
				return partyType === 'Employee' ? 'Employee Payment' : 'Supplier Payment';
			}
			return 'Payment';
		},

		// New method to get payment color
		getPaymentColor(partyType, paymentType) {
			if (paymentType === 'Receive') {
				if (partyType === 'Customer') return 'success';
				if (partyType === 'Employee') return 'info';
				if (partyType === 'Supplier') return 'warning';
				return 'success';
			} else {
				if (partyType === 'Employee') return 'error';
				if (partyType === 'Supplier') return 'warning';
				return 'error';
			}
		}
	}
}
</script>

<style scoped>
.history-item {
	border: 1px solid #e0e0e0;
	border-radius: 8px;
	transition: all 0.2s ease;
	cursor: pointer;
}

.history-item:hover {
	background-color: #f5f5f5;
	transform: translateY(-1px);
	box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.selected-invoice {
	background-color: #e3f2fd;
	border-color: #2196f3;
}

.payment-item {
	border: 1px solid #e0e0e0;
	border-radius: 8px;
	transition: all 0.2s ease;
	cursor: pointer;
}

.payment-item:hover {
	background-color: #fff3f3;
	transform: translateY(-1px);
	box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.selected-payment {
	background-color: #ffebee;
	border-color: #f44336;
}

.border-top {
	border-top: 1px solid #e0e0e0;
}

.v-empty-state {
	text-align: center;
	padding: 2rem;
}

/* Invoice Details Card Styles */
.invoice-details-card {
	border: 1px solid #e0e0e0;
	border-radius: 12px;
	box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.detail-section {
	background-color: #f8f9fa;
	border: 1px solid #e9ecef;
	border-radius: 8px;
	padding: 12px;
	margin-bottom: 12px;
	height: 100%;
}

.section-header {
	display: flex;
	align-items: center;
	margin-bottom: 8px;
	padding-bottom: 4px;
	border-bottom: 1px solid #dee2e6;
}

.section-title {
	font-weight: 600;
	color: #495057;
	font-size: 0.875rem;
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.section-content {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.detail-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 6px 0;
	border-bottom: 1px solid #f0f0f0;
	min-height: 32px;
}

.detail-row:last-child {
	border-bottom: none;
}

.detail-label {
	font-weight: 500;
	color: #666;
	min-width: 100px;
	font-size: 0.875rem;
}

.detail-value {
	color: #333;
	text-align: right;
	font-size: 0.875rem;
	flex: 1;
}

.action-btn {
	border-radius: 8px;
	font-weight: 500;
	min-width: 120px;
	height: 40px;
}

.search-btn {
	border-radius: 8px;
	font-weight: 500;
	height: 40px;
}

/* Items Table Styles */
.items-table {
	width: 100%;
	border: 1px solid #e0e0e0;
	border-radius: 8px;
	overflow: hidden;
}

.items-table th {
	background-color: #f5f5f5 !important;
	font-weight: 600 !important;
	color: #333 !important;
	border-bottom: 2px solid #e0e0e0 !important;
	padding: 12px 8px !important;
	font-size: 0.875rem !important;
}

.items-table td {
	padding: 8px !important;
	border-bottom: 1px solid #f0f0f0 !important;
	vertical-align: middle !important;
}

.items-table tr:hover td {
	background-color: #f8f9fa !important;
}

.item-name {
	font-weight: 500;
	color: #333;
	line-height: 1.2;
}

/* Responsive adjustments */
@media (max-width: 768px) {
	.detail-section {
		margin-bottom: 8px;
		padding: 8px;
	}
	
	.action-btn {
		min-width: 100px;
		font-size: 0.875rem;
		height: 36px;
	}
	
	.detail-row {
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
	}
	
	.detail-label {
		min-width: auto;
	}
	
	.detail-value {
		text-align: left;
	}
	
	.items-table {
		font-size: 0.75rem;
	}
	
	.items-table th,
	.items-table td {
		padding: 6px 4px !important;
	}
}

/* Summary Bottom Bar */
.summary-bar {
	background-color: #f8f9fa;
	border-top: 1px solid #e0e0e0;
	border-radius: 0 0 8px 8px;
}

.text-teal {
	color: #009688 !important;
}

.text-green {
	color: #4caf50 !important;
}

.invoice-details-card .v-card-text {
	max-height: 400px;
	overflow-y: auto;
}

.invoice-details-card .v-card__text {
	padding: 16px !important;
}

/* Summary Section Styles */
.summary-card {
	border: 1px solid #e0e0e0;
	border-radius: 8px;
}

.summary-item {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 4px 0;
}

.summary-label {
	font-weight: 500;
	color: #666;
	font-size: 0.875rem;
}

.summary-value {
	font-size: 0.875rem;
}
</style>
