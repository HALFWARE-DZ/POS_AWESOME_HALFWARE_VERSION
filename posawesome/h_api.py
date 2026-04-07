import frappe
import random
from datetime import datetime


def generate_structured_barcode():
    now = datetime.now()
    
    yy = now.strftime("%y")
    mm = now.strftime("%m")
    
    random_part = ''.join(random.choices('0123456789', k=6))
    
    return f"{yy}{mm}{random_part}"


def generate_unique_barcode(doctype, fieldname):
    while True:
        barcode = generate_structured_barcode()

        if not frappe.db.exists(doctype, {fieldname: barcode}):
            return barcode


@frappe.whitelist()
def generate_salesinvoice_barcode(doc, method):
    if not doc.custom_barcode:
        doc.custom_barcode = generate_unique_barcode(
            "Sales Invoice",
            "custom_barcode"
        )
