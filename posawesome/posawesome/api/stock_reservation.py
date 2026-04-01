# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.query_builder import DocType
from frappe.query_builder.functions import Sum
from frappe.utils import getdate, formatdate


@frappe.whitelist()
def get_item_qty_summary(item_code, warehouse):
    """
    Get item quantity summary including available and reserved quantities
    
    Args:
        item_code (str): Item code
        warehouse (str): Main warehouse name
    
    Returns:
        dict: {
            'available_qty': float,
            'reserved_qty': float, 
            'reserved_list': [
                {
                    'invoice_name': str,
                    'qty': float,
                    'due_date': str
                }, ...
            ]
        }
    """
    try:
        # Validate inputs
        if not item_code or not warehouse:
            frappe.throw(_("Item code and warehouse are required"))
        
        # Get available quantity from main warehouse
        available_qty = get_available_qty(item_code, warehouse)
        
        # Get reserved quantity and details
        reserved_qty, reserved_list = get_reserved_details(item_code, warehouse)
        
        return {
            'available_qty': available_qty,
            'reserved_qty': reserved_qty,
            'reserved_list': reserved_list
        }
        
    except Exception as e:
        frappe.log_error(f"Error in get_item_qty_summary: {str(e)}", "Stock Reservation API")
        frappe.throw(_("Failed to get item quantity summary: {0}").format(str(e)))


def get_available_qty(item_code, warehouse):
    """Get actual available quantity for item in warehouse"""
    try:
        # Get bin data for the item and warehouse
        bin_data = frappe.db.get_value(
            "Bin",
            {"item_code": item_code, "warehouse": warehouse},
            ["actual_qty", "reserved_qty", "ordered_qty", "indented_qty"]
        )
        
        if bin_data:
            actual_qty, reserved_qty, ordered_qty, indented_qty = bin_data
            # Available quantity = actual_qty - reserved_qty + ordered_qty
            return flt(actual_qty) - flt(reserved_qty) + flt(ordered_qty)
        else:
            return 0.0
            
    except Exception as e:
        frappe.log_error(f"Error getting available qty for {item_code} in {warehouse}: {str(e)}", "Stock Reservation")
        return 0.0


def get_reserved_details(item_code, main_warehouse):
    """
    Get reserved quantity and list of reservations for an item
    
    Args:
        item_code (str): Item code
        main_warehouse (str): Main warehouse name
    
    Returns:
        tuple: (total_reserved_qty, reserved_list)
    """
    try:
        reserved_warehouse = "RESERVE - HW"
        
        # Query Stock Entries that transfer from main warehouse to reserve warehouse
        StockEntry = DocType("Stock Entry")
        StockEntryDetail = DocType("Stock Entry Detail")
        
        query = (
            frappe.qb.from_(StockEntry)
            .join(StockEntryDetail)
            .on(StockEntry.name == StockEntryDetail.parent)
            .select(
                StockEntry.name.as_("stock_entry_name"),
                StockEntry.reference_name.as_("invoice_name"),
                StockEntryDetail.qty.as_("qty"),
                StockEntry.posting_date.as_("posting_date")
            )
            .where(
                (StockEntry.docstatus == 1) &
                (StockEntry.purpose == "Material Transfer") &
                (StockEntry.s_warehouse == main_warehouse) &
                (StockEntry.t_warehouse == reserved_warehouse) &
                (StockEntryDetail.item_code == item_code) &
                (StockEntry.reference_type == "Sales Invoice")
            )
            .orderby(StockEntry.posting_date, order="desc")
        )
        
        stock_entries = query.run(as_dict=True)
        
        reserved_list = []
        total_reserved_qty = 0.0
        
        for entry in stock_entries:
            # Get delivery date from Sales Invoice
            due_date = get_invoice_delivery_date(entry.invoice_name)
            
            # Get customer name (optional)
            customer_name = get_invoice_customer(entry.invoice_name)
            
            reserved_item = {
                'invoice_name': entry.invoice_name,
                'qty': flt(entry.qty),
                'due_date': format_due_date(due_date) if due_date else "",
                'customer_name': customer_name or ""
            }
            
            reserved_list.append(reserved_item)
            total_reserved_qty += flt(entry.qty)
        
        return total_reserved_qty, reserved_list
        
    except Exception as e:
        frappe.log_error(f"Error getting reserved details for {item_code}: {str(e)}", "Stock Reservation")
        return 0.0, []


def get_invoice_delivery_date(invoice_name):
    """Get delivery date from Sales Invoice"""
    try:
        if not invoice_name:
            return None
            
        delivery_date = frappe.db.get_value(
            "Sales Invoice",
            invoice_name,
            "posa_delivery_date"
        )
        
        return delivery_date
        
    except Exception as e:
        frappe.log_error(f"Error getting delivery date for invoice {invoice_name}: {str(e)}", "Stock Reservation")
        return None


def get_invoice_customer(invoice_name):
    """Get customer name from Sales Invoice"""
    try:
        if not invoice_name:
            return None
            
        customer = frappe.db.get_value(
            "Sales Invoice", 
            invoice_name,
            "customer"
        )
        
        return customer
        
    except Exception as e:
        frappe.log_error(f"Error getting customer for invoice {invoice_name}: {str(e)}", "Stock Reservation")
        return None


def format_due_date(date_str):
    """Format due date as 'Jan 15, 2026'"""
    try:
        if not date_str:
            return ""
            
        date_obj = getdate(date_str)
        return formatdate(date_obj, "MMM dd, yyyy")
        
    except Exception:
        return date_str


def flt(value):
    """Convert to float with safety"""
    try:
        return float(value or 0)
    except (ValueError, TypeError):
        return 0.0
