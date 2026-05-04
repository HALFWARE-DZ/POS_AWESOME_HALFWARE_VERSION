<template>
	<v-card class="attribute-search-dialog pos-themed-card">
		<v-card-title class="d-flex align-center pa-4">
			<v-icon color="primary" class="mr-2">mdi-filter-variant</v-icon>
			<span class="text-h6">{{ __("Rechercher des articles par attributs") }}</span>
			<v-spacer></v-spacer>
			<v-btn
				icon="mdi-close"
				variant="text"
				density="compact"
				@click="$emit('close')"
				:aria-label="__('Close dialog')"
			>
			</v-btn>
		</v-card-title>

		<v-divider></v-divider>

		<v-card-text class="pa-4">
			<!-- Search Form -->
			<v-row class="mb-4">
				<v-col cols="12" md="8">
					<v-text-field
						v-model="searchValue"
						:label="__('Rechercher par Taille, Couleur, ou tout attribut')"
						variant="outlined"
						density="compact"
						hide-details
						clearable
						placeholder="Entrez une valeur d'attribut (ex: 45, Noir, M, L, etc.)"
						@keyup.enter="searchItems"
						class="pos-themed-input"
					>
						<template v-slot:append-inner>
							<v-btn
								icon="mdi-magnify"
								size="small"
								color="primary"
								variant="text"
								@click="searchItems"
								:disabled="!canSearch"
								:loading="searching"
							></v-btn>
						</template>
					</v-text-field>
				</v-col>
				<v-col cols="12" md="4">
					<v-btn
						block
						color="primary"
						variant="tonal"
						@click="searchItems"
						:disabled="!canSearch"
						:loading="searching"
						class="search-btn"
					>
						{{ __("Rechercher") }}
					</v-btn>
				</v-col>
			</v-row>

			<!-- Loading State -->
			<div v-if="searching" class="text-center py-8">
				<v-progress-linear
					indeterminate
					color="primary"
					height="4"
					class="mb-4"
				></v-progress-linear>
				<div class="text-body-2 text-medium-emphasis">
					{{ __("Recherche en cours...") }}
				</div>
			</div>

			<!-- Results -->
			<div v-else-if="searchResults.length > 0" class="results-container">
				<!-- Template List View -->
				<div v-if="!selectedTemplate" class="template-list-view">
					<div class="results-header mb-4">
						<div class="text-subtitle-1 font-weight-medium">
							{{ __("Trouvé {0} modèles avec des articles correspondants").replace("{0}", searchResults.length) }}
						</div>
					</div>

					<!-- Template Table -->
					<v-data-table
						:headers="templateHeaders"
						:items="searchResults"
						class="template-table pos-themed-table"
						@click:row="selectTemplate"
						hover
						density="compact"
					>
						<template v-slot:item.template_image="{ item }">
							<v-avatar size="40" class="mr-2">
								<v-img
									v-if="item.template_image"
									:src="item.template_image"
									aspect-ratio="1"
								>
									<template #placeholder>
										<v-icon size="20" color="grey-lighten-2">mdi-image</v-icon>
									</template>
								</v-img>
								<v-icon v-else size="20" color="grey-lighten-2">mdi-image</v-icon>
							</v-avatar>
						</template>
						<template v-slot:item.total_available_qty="{ item }">
							<v-chip
								:color="item.total_available_qty > 0 ? 'success' : 'error'"
								variant="tonal"
								size="small"
							>
								{{ item.total_available_qty }} {{ item.stock_uom }}
							</v-chip>
						</template>
						<template v-slot:item.variant_count="{ item }">
							<v-chip color="primary" variant="tonal" size="small">
								{{ item.variant_count }}
							</v-chip>
						</template>
					</v-data-table>
				</div>

				<!-- Matrix View -->
				<div v-else class="matrix-view">
					<div class="matrix-header d-flex align-center mb-4">
						<v-btn
							icon="mdi-arrow-left"
							variant="text"
							@click="selectedTemplate = null"
							class="mr-2"
						>
						</v-btn>
						<div class="flex-grow-1">
							<div class="text-h6 font-weight-medium">{{ selectedTemplate.template_name }}</div>
							<div class="text-caption text-medium-emphasis">{{ selectedTemplate.template_code }}</div>
						</div>
						<v-chip color="success" variant="tonal">
							{{ __("Total: {0} {1}").replace("{0}", selectedTemplate.total_available_qty).replace("{1}", selectedTemplate.stock_uom) }}
						</v-chip>
					</div>

					<!-- Variants Visual List -->
					<div class="variants-visual-list">
						<div class="text-subtitle-1 font-weight-medium mb-4">
							{{ __("Variantes disponibles") }}
						</div>
						<div class="variants-grid">
							<div
								v-for="variant in selectedTemplate.variants"
								:key="variant.item_code"
								class="variant-visual-card"
							>
								<div class="variant-header">
									<div class="variant-attributes">
										<span v-for="(value, attr) in variant.attributes" :key="attr" class="attribute-tag">
											{{ value }}
										</span>
									</div>
								</div>
								<div class="variant-footer">
									<v-chip
										:color="variant.total_qty > 5 ? 'success' : variant.total_qty > 0 ? 'warning' : 'error'"
										variant="tonal"
										size="small"
										class="qty-chip"
									>
										<v-icon size="14" class="mr-1">mdi-package-variant-closed</v-icon>
										{{ variant.total_qty }} {{ __("disponible") }}
									</v-chip>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- No Results -->
			<div v-else-if="hasSearched && !searching" class="text-center py-8">
				<v-icon size="64" color="grey-lighten-1" class="mb-4">
					mdi-package-variant-closed
				</v-icon>
				<div class="text-h6 text-medium-emphasis mb-2">
					{{ __("Aucun article trouvé") }}
				</div>
				<div class="text-body-2 text-medium-emphasis mb-4">
					{{ __("Essayez d'ajuster vos critères de recherche") }}
				</div>
			</div>

			<!-- Initial State -->
			<div v-else class="text-center py-8">
				<v-icon size="64" color="grey-lighten-1" class="mb-4">
					mdi-filter-variant
				</v-icon>
				<div class="text-h6 text-medium-emphasis mb-2">
					{{ __("Rechercher par toute valeur d'attribut") }}
				</div>
				<div class="text-body-2 text-medium-emphasis">
					{{ __("Entrez une valeur d'attribut (Taille, Couleur, etc.) pour trouver des articles correspondants") }}
				</div>
			</div>
		</v-card-text>

		<v-card-actions class="pa-4 pt-0">
			<v-spacer></v-spacer>
			<v-btn
				color="error"
				variant="text"
				@click="$emit('close')"
			>
				{{ __("Fermer") }}
			</v-btn>
		</v-card-actions>
	</v-card>
</template>

<script>
export default {
	name: "ItemAttributeSearchDialog",
	props: {
		posProfile: {
			type: Object,
			default: () => ({}),
		},
	},
	emits: ["close"],
	data() {
		return {
			searchValue: null,
			searchResults: [],
			selectedTemplate: null,
			searching: false,
			hasSearched: false,
			templateHeaders: [
				{ title: "", key: "template_image", sortable: false, width: "60px" },
				{ title: __("Nom du modèle"), key: "template_name" },
				{ title: __("Référence"), key: "template_code" },
				{ title: __("Quantité disponible"), key: "total_available_qty" },
				{ title: __("Variantes"), key: "variant_count" },
			],
		};
	},
	computed: {
		canSearch() {
			return this.searchValue && this.searchValue.trim();
		},
	},
	methods: {
		async searchItems() {
			if (!this.canSearch) {
				return;
			}

			this.searching = true;
			this.hasSearched = true;

			console.log(`Searching for items with attribute value: ${this.searchValue.trim()}`);

			try {
				const response = await frappe.call({
					method: "posawesome.posawesome.api.items.search_items_by_attributes",
					args: {
						attribute_type: "Any",  // Not used anymore
						search_value: this.searchValue.trim(),
						pos_profile: JSON.stringify(this.posProfile),
					},
				});

				console.log("Search response:", response);

				if (response.message && Array.isArray(response.message)) {
					this.searchResults = response.message;
					console.log(`Found ${this.searchResults.length} templates`);
				} else {
					this.searchResults = [];
					console.log("No search results found");
				}
			} catch (error) {
				console.error("Error searching items:", error);
				frappe.show_alert({
					message: __("Failed to search items"),
					indicator: "red",
				});
				this.searchResults = [];
			} finally {
				this.searching = false;
			}
		},

		selectTemplate(event, item) {
			this.selectedTemplate = item.item;
		},
	},
};
</script>

<style scoped>
.attribute-search-dialog {
	max-height: 80vh;
}

.template-table {
	cursor: pointer;
}

.template-table tbody tr:hover {
	background-color: rgba(0, 0, 0, 0.04);
}

.matrix-view {
	max-height: 60vh;
	overflow-y: auto;
}

.variants-visual-list {
	padding: 16px 0;
}

.variants-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	gap: 16px;
}

.variant-visual-card {
	background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%);
	border: 1px solid #e9ecef;
	border-radius: 16px;
	padding: 16px;
	transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	position: relative;
	overflow: hidden;
}

.variant-visual-card::before {
	content: '';
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	height: 4px;
	background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
	border-radius: 16px 16px 0 0;
}

.variant-visual-card:hover {
	transform: translateY(-2px);
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
	border-color: #667eea;
}

.variant-header {
	margin-bottom: 12px;
}

.variant-attributes {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: center;
}

.attribute-tag {
	background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
	color: white;
	padding: 6px 12px;
	border-radius: 20px;
	font-size: 0.875rem;
	font-weight: 600;
	letter-spacing: 0.5px;
	text-transform: uppercase;
	box-shadow: 0 2px 4px rgba(102, 126, 234, 0.3);
}

.variant-footer {
	display: flex;
	justify-content: flex-end;
	align-items: center;
}

.qty-chip {
	font-weight: 600;
	border-radius: 12px;
}

.results-container {
	max-height: 60vh;
	overflow-y: auto;
}

.search-btn {
	min-height: 40px;
}

/* Mobile responsiveness */
@media (max-width: 768px) {
	.variants-grid {
		grid-template-columns: 1fr;
	}
	
	.variant-visual-card {
		padding: 12px;
	}
	
	.attribute-tag {
		font-size: 0.75rem;
		padding: 4px 8px;
	}
	
	.template-table {
		font-size: 0.875rem;
	}
}

/* Dark theme support */
@media (prefers-color-scheme: dark) {
	.variant-visual-card {
		background: linear-gradient(135deg, #2c2c2c 0%, #1a1a1a 100%);
		border-color: #444;
	}
	
	.variant-visual-card:hover {
		border-color: #667eea;
	}
	
	.attribute-tag {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
	}
	
	.template-table tbody tr:hover {
		background-color: rgba(255, 255, 255, 0.04);
	}
}
</style>
