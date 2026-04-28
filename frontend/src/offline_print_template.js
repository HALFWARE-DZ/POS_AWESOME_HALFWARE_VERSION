/* global frappe */
import { getPrintTemplate, getTermsAndConditions, memoryInitPromise } from "./offline/index.js";
import nunjucks from "nunjucks";

function normaliseTemplate(template) {
	// Nunjucks doesn't understand Python-style triple quotes.
	// Convert any """multiline""" strings to standard JS strings so the
	// renderer can parse templates that include SQL or other blocks.
	if (!template) return template;
	return template.replace(/"""([\s\S]*?)"""/g, (_, str) => {
		const escaped = str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
		return `"${escaped}"`;
	});
}

function attachFormatter(obj) {
	if (!obj || typeof obj !== "object" || obj.get_formatted) return;
	// mimic Frappe's get_formatted by returning the raw field value
	obj.get_formatted = function (field) {
		return this?.[field];
	};
}

function computePaidAmount(doc) {
	if (!doc) return 0;

	const paymentsTotal = (doc.payments || []).reduce(
		(sum, p) => sum + Math.abs(parseFloat(p.amount) || 0),
		0,
	);

	const creditSale =
		doc.is_credit_sale === true ||
		doc.is_credit_sale === 1 ||
		doc.is_credit_sale === "1" ||
		String(doc.is_credit_sale).toLowerCase() === "yes";

	if (creditSale || paymentsTotal === 0) {
		return 0;
	}

	const base = doc.paid_amount ?? doc.grand_total ?? 0;
	return paymentsTotal || base;
}

function defaultOfflineHTML(invoice, terms = "") {
	if (!invoice) return "";

	// Calculate total item discount
	let totalItemDiscount = 0;
	const itemsRows = (invoice.items || []).map((it) => {
		const itemDiscount = (it.discount_amount || 0) * Math.abs(it.qty || 1);
		totalItemDiscount += itemDiscount;
		
		const sn = it.serial_no
			? `<div class="item-serial">Serie: ${it.serial_no.replace(/\n/g, ", ")}</div>`
			: "";
		
		const hasDiscount = it.discount_percentage > 0 || it.discount_amount > 0;
		let discountDisplay = "-";
		if (hasDiscount) {
			if (it.discount_percentage > 0) {
				discountDisplay = `-${it.discount_percentage}%<br>-${formatNumber(itemDiscount)}`;
			} else if (it.discount_amount > 0) {
				discountDisplay = `-${formatNumber(itemDiscount)}`;
			}
		}

		return `<div class="item">
			<div class="table-row">
				<div class="col-article">${it.item_name || it.item_code}</div>
				<div class="col-qty">${Math.abs(it.qty || 0).toFixed(0)}</div>
				<div class="col-price">${formatNumber(it.price_list_rate || it.rate)}</div>
				<div class="col-discount">${discountDisplay}</div>
				<div class="col-total">${formatNumber(it.amount)}</div>
			</div>
			${sn}
		</div>`;
	}).join("");

	// Calculate totals
	const subtotal = invoice.total || 0;
	const netTotal = invoice.net_total || 0;
	const itemsDiscount = subtotal - netTotal;
	const globalDiscount = invoice.discount_amount || 0;
	const taxes = invoice.total_taxes_and_charges || 0;
	const grandTotal = invoice.grand_total || 0;
	const rounding = invoice.rounding_adjustment || 0;
	const roundedTotal = invoice.rounded_total || grandTotal;
	const paidAmount = computePaidAmount(invoice);
	const changeAmount = invoice.change_amount || 0;
	const outstandingAmount = invoice.outstanding_amount || 0;

	// Document type
	let docType = "BON DE CAISSE";
	if (invoice.is_return == 1) {
		docType = "BON DE RETOUR";
	} else if (invoice.custom_is_reserve == 1) {
		docType = "BON DE RESERVATION";
	}

	// Payment status
	let paymentStatus = "NON PAYE";
	let paymentStatusClass = "";
	if (invoice.status === "Paid") {
		paymentStatus = "PAYE INTEGRALEMENT";
		paymentStatusClass = "paid";
	} else if (invoice.status === "Partially Paid" || outstandingAmount > 0) {
		paymentStatus = "PAIEMENT PARTIEL";
		paymentStatusClass = "partial";
	}

	// Payment modes
	const paymentRows = (invoice.payments || []).map(payment => 
		`<div class="total-line" style="font-size: 7.5pt;">
			<span>${payment.mode_of_payment}:</span>
			<span>${formatNumber(payment.amount)} DA</span>
		</div>`
	).join("");

	const termsSection = terms || invoice.terms || 
		`<b>IMPORTANT</b> <br>
		NOUS INFORMONS NOTRE AIMABLE CLIENTEL OUE TOUT ARTICLE ACHETE PEUT ETRE ECHANGE DANS UN DELAI DE 10 JOURS
		<br>
		SOUS RESERVE DE PRENTATION LE TICKET DE CAISSE ET QUE LE PRODUIT SOIT CONSERVE DANS SON EMBALLAGE D ORIGINE --
		<br>
		LES ARTICLES EN PROMOTION OU EN SOLDES NE SONT NI REPRIS NI ECHENGES`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invoice ${invoice.name || ""}</title>
    <style>
        * {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}

		@page {
			size: 80mm auto;
			margin: 2mm 3mm;
		}

		body {
			font-family: 'Courier New', Courier, monospace;
			font-size: 12pt;
			line-height: 1.2;
			padding: 2mm;
			width: 80mm;
			background: white;
			font-weight: bold;
		}

		.receipt {
			width: 100%;
		}

		/* Header */
		.header {
			text-align: center;
			margin-bottom: 5px;
			padding-bottom: 5px;
		}

		.company-name {
			font-size: 12pt;
			font-weight: bold;
			text-transform: uppercase;
			margin-bottom: 2px;
		}

		.company-details {
			font-size: 8pt;
			line-height: 1.3;
			font-weight: bold;
		}

		/* Document type */
		.doc-type {
			text-align: center;
			margin: 5px 0;
			padding: 3px;
			font-weight: bold;
			font-size: 10pt;
		}

		.doc-type.return {
			background: #000;
			color: white;
		}

		.doc-type.reservation {
			padding: 3px;
		}

		/* Invoice metadata */
		.meta {
			margin: 5px 0;
			padding: 3px 0;
			font-size: 8pt;
		}

		.meta-line {
			display: flex;
			justify-content: space-between;
			margin: 1px 0;
		}

		.labell {
			font-weight: bold;
		}

		/* Items table */
		.items {
			margin: 5px 0;
			font-size: 8pt;
		}

		.items-header {
			font-weight: bold;
			border-bottom: 1px solid #000;
			padding: 2px 0;
			margin-bottom: 3px;
		}

		.table-row {
			display: flex;
			padding: 1px 0;
		}

		.col-article {
			flex: 3;
			font-weight: bold;
			padding-right: 2px;
		}

		.col-qty {
			flex: 1;
			text-align: center;
		}

		.col-price {
			flex: 1.5;
			text-align: right;
		}

		.col-discount {
			flex: 1.5;
			text-align: center;
			color: #000000;
		}

		.col-total {
			flex: 1.5;
			text-align: right;
			font-weight: bold;
		}

		.item {
			margin: 2px 0;
			padding-bottom: 2px;
			border-bottom: 1px dotted #ccc;
		}

		.item-serial {
			font-size: 7pt;
			color: #666;
			margin-top: 1px;
			padding-left: 2px;
		}

		/* Totals */
		.totals {
			margin: 5px 0;
			padding-top: 3px;
			font-size: 8pt;
		}

		.total-line {
			display: flex;
			justify-content: space-between;
			margin: 2px 0;
		}

		.total-grand {
			font-size: 10pt;
			font-weight: bold;
			padding: 3px 0;
			margin-top: 3px;
		}

		/* Payment section */
		.payment {
			margin: 5px 0;
			padding: 3px;
			font-size: 8pt;
		}

		.payment-status {
			font-weight: bold;
			text-align: center;
			padding: 2px;
			margin-bottom: 3px;
		}

		.payment-status.paid {
			background: #000;
			color: white;
		}

		.payment-status.partial {
			background: #000000;
			color: white;
		}

		/* Footer */
		.footer {
			margin-top: 8px;
			padding-top: 5px;
			text-align: center;
			font-size: 8pt !important;
			font-weight: 600 !important;
		}

		.footer-msg {
			margin: 3px 0;
		}

		.barcode-area {
			text-align: center;
			margin: 5px 0;
			font-weight: 200 !important;
		}

		/* Reservation info */
		.reservation-box {
			margin: 5px 0;
			padding: 3px;
			font-size: 8pt;
			text-align: center;
		}

		/* Print optimization */
		@media print {
			body {
				padding: 0;
			}
		}
    </style>
</head>
<body>
    <div class="receipt">
		<!-- HEADER -->
		<div class="header">
			<div class="company-name">${invoice.company || ""}</div>
			<div class="company-details">
				${invoice.company_address_display ? invoice.company_address_display.replace(/\n/g, ' ') : ""}
				${invoice.company_phone ? `<br>Tel: ${invoice.company_phone}` : ""}
			</div>
		</div>

		<!-- DOCUMENT TYPE -->
		<div class="doc-type ${invoice.is_return == 1 ? 'return' : invoice.custom_is_reserve == 1 ? 'reservation' : ''}">${docType}</div>
		${invoice.is_return == 1 && invoice.return_against ? 
			`<div style="text-align: center; font-size: 8pt; margin: 3px 0;">Retour de: ${invoice.return_against}</div>` : ""}

		<!-- METADATA -->
		<div class="meta">
			<div class="meta-line">
				<span class="labell">N Facture:</span>
				<span>${invoice.name || ""}</span>
			</div>
			<div class="meta-line">
				<span class="labell">Date:</span>
				<span>${invoice.posting_date || ""} ${invoice.posting_time ? invoice.posting_time + ':00' : ''}</span>
			</div>
			<div class="meta-line">
				<span class="labell">Client:</span>
				<span>${invoice.customer_name || invoice.customer || ""}</span>
			</div>
			${invoice.contact_mobile ? 
				`<div class="meta-line">
					<span class="labell">Tel:</span>
					<span>${invoice.contact_mobile}</span>
				</div>` : ""}
			<div class="meta-line">
				<span class="labell">Caissier:</span>
				<span>${invoice.pos_profile ? invoice.pos_profile.split('@')[0] : ""}</span>
			</div>
		</div>

		<!-- RESERVATION INFO -->
		${invoice.custom_is_reserve == 1 ? 
			`<div class="reservation-box">
				<div style="font-weight: bold; margin-bottom: 2px;">RESERVATION ACTIVE</div>
				${invoice.due_date ? `<div>Expire: ${invoice.due_date}</div>` : ""}
				${invoice.posa_reservation_deposit ? `<div>Acompte: ${formatNumber(invoice.posa_reservation_deposit)} DA</div>` : ""}
			</div>` : ""}

		<!-- ITEMS -->
		<div class="items">
			<div class="items-header">
				<div class="table-row">
					<div class="col-article">Article</div>
					<div class="col-qty">Qte</div>
					<div class="col-price">Prix</div>
					<div class="col-discount">Remise</div>
					<div class="col-total">Total</div>
				</div>
			</div>
			${itemsRows}
		</div>

		<div class="totals">
			<!-- Sous-total (before discount) -->
			<div class="total-line">
				<span>Sous-total:</span>
				<span>${formatNumber(subtotal)} DA</span>
			</div>

			<!-- Total item discount -->
			<div class="total-line">
				<span>Total Remise Accordée (articles):</span>
				<span>-${formatNumber(totalItemDiscount)} DA</span>
			</div>

			<!-- ERPNext calculated item discount -->
			${itemsDiscount > 0.01 ? 
				`<div class="total-line">
					<span>Remise Articles :</span>
					<span>-${formatNumber(itemsDiscount)} DA</span>
				</div>` : ""}

			<!-- Global discount -->
			${globalDiscount > 0 ? 
				`<div class="total-line">
					<span>Remise Globale${invoice.additional_discount_percentage > 0 ? ` (${invoice.additional_discount_percentage}%)` : ""}:</span>
					<span>-${formatNumber(globalDiscount)} DA</span>
				</div>` : ""}

			<!-- Net total -->
			${itemsDiscount > 0.01 || globalDiscount > 0 ? 
				`<div class="total-line">
					<span>Net HT:</span>
					<span>${formatNumber(netTotal)} DA</span>
				</div>` : ""}

			<!-- TVA -->
			${taxes > 0 ? 
				`<div class="total-line">
					<span>TVA:</span>
					<span>${formatNumber(taxes)} DA</span>
				</div>` : ""}

			<!-- TOTAL -->
			<div class="total-line total-grand">
				<span>TOTAL TTC:</span>
				<span>${formatNumber(grandTotal)} DA</span>
			</div>

			<!-- Rounding -->
			${Math.abs(rounding) > 0.01 ? 
				`<div class="total-line">
					<span>Arrondi:</span>
					<span>${formatNumber(rounding)} DA</span>
				</div>
				<div class="total-line total-grand">
					<span>NET A PAYER:</span>
					<span>${formatNumber(roundedTotal)} DA</span>
				</div>` : ""}
		</div>

		<!-- PAYMENT -->
		<div class="payment">
			<div class="payment-status ${paymentStatusClass}">${paymentStatus}</div>

			<div class="total-line">
				<span>Montant paye:</span>
				<span>${formatNumber(paidAmount)} DA</span>
			</div>

			${outstandingAmount > 0 ? 
				`<div class="total-line">
					<span>Reste a payer:</span>
					<span>${formatNumber(outstandingAmount)} DA</span>
				</div>` : ""}

			<!-- Payment modes -->
			${paymentRows}

			<!-- Change -->
			${changeAmount > 0 ? 
				`<div class="total-line" style="margin-top: 2px; padding-top: 2px;">
					<span>Rendu:</span>
					<span><strong>${formatNumber(changeAmount)} DA</strong></span>
				</div>` : ""}
		</div>

		<!-- BARCODE -->
		${invoice.name ? 
			`<div class="barcode-area">
				<svg id="barcode"></svg>
			</div>` : ""}

		<!-- FOOTER -->
		<div class="footer">
			${invoice.custom_is_reserve == 1 ? 
				`<div class="footer-msg" style="font-weight: bold;">
					Stock reserve - Acompte verse<br>
					Finaliser avant expiration
				</div>` : 
				invoice.is_return == 1 ? 
				`<div class="footer-msg" style="font-weight: bold;">
					Articles retournes<br>
					Remboursement effectue
				</div>` : 
				`<div class="footer-msg">Merci De Votre Confiance Et A Bientot !</div>`}
			
			<div class="footer-msg" style="margin-top: 4px;">
				${termsSection.replace(/\n/g, ' - ')}
			</div>
			
			<div class="footer-msg" style="margin-top: 4px;">
				${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'})}
			</div>
		</div>
	</div>

	<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
	<script>
		${invoice.name ? 
			`try {
				JsBarcode("#barcode", "${invoice.custom_barcode || invoice.name}", {
					format: "CODE128",
					width: 1.5,
					height: 35,
					displayValue: true,
					fontSize: 10,
					margin: 5
				});
			} catch(e) {
				console.error("Barcode error:", e);
			}` : ""}

		window.onload = function() {
			setTimeout(function() {
				window.print();
			}, 300);
		};
	</script>
</body>
</html>`;
}

// Helper function to format numbers
function formatNumber(num) {
	if (typeof num !== 'number') {
		num = parseFloat(num) || 0;
	}
	return num.toLocaleString('fr-FR', {maximumFractionDigits: 0});
}

export default async function renderOfflineInvoiceHTML(invoice) {
	if (!invoice) return "";

	await memoryInitPromise;

	const template = normaliseTemplate(getPrintTemplate());
	const terms = getTermsAndConditions();
	const doc = {
		...invoice,
		terms: invoice.terms || terms,
		terms_and_conditions: invoice.terms_and_conditions || terms,
	};

	doc.paid_amount = computePaidAmount(doc);
	attachFormatter(doc);
	(doc.items || []).forEach(attachFormatter);
	(doc.taxes || []).forEach(attachFormatter);

	if (!template) {
		console.warn("No offline print template cached; using fallback template");
		return defaultOfflineHTML(doc, doc.terms_and_conditions);
	}

	try {
		const env = nunjucks.configure({ autoescape: false });
		env.addFilter("format_currency", (value, currency) => {
			const number = typeof value === "number" ? value : parseFloat(value);
			if (Number.isNaN(number)) return value;
			try {
				return new Intl.NumberFormat(undefined, {
					style: currency ? "currency" : "decimal",
					currency: currency || undefined,
				}).format(number);
			} catch {
				return currency ? `${currency} ${number}` : String(number);
			}
		});
		env.addFilter("currency", (value, currency) => env.filters.format_currency(value, currency));
		env.getFilter = function (name) {
			return this.filters[name] || ((v) => v);
		};

		const context = {
			doc,
			terms: doc.terms,
			terms_and_conditions: doc.terms_and_conditions,
			_: frappe?._ ? frappe._ : (t) => t,
			frappe: {
				db: { get_value: () => "", sql: () => [] },
				get_list: () => [],
			},
		};
		return env.renderString(template, context);
	} catch (e) {
		console.error("Failed to render offline invoice", e);
		return defaultOfflineHTML(doc, doc.terms_and_conditions);
	}
}
