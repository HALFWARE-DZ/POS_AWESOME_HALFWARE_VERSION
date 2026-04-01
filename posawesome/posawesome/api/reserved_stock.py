# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.query_builder import DocType
from frappe.query_builder.functions import Sum
from frappe.query_builder import Order


@frappe.whitelist()
def get_reserved_stock_info(item_code, warehouse):
    """
    Get reserved stock information for an item.
    
    Args:
        item_code: Item code
        warehouse: Main warehouse name
        
    Returns:
        dict: {
            available_qty: float,
            reserved_qty: float,
            reserved_invoices: list[str]
        }
    """
    if not item_code or not warehouse:
        return {
            "available_qty": 0,
            "reserved_qty": 0,
            "reserved_invoices": []
        }
    
    # Debug logging - check what warehouse names we're actually using
    frappe.logger().info(f"DEBUG: Getting reserved stock info for item {item_code} in warehouse {warehouse}")
    
    # Check if warehouse exists
    warehouse_exists = frappe.db.exists("Warehouse", warehouse)
    frappe.logger().info(f"DEBUG: Warehouse '{warehouse}' exists: {warehouse_exists}")
    
    # Check all warehouses for this item
    bin_doctype = DocType("Bin")
    all_warehouses_for_item = (
        frappe.qb.from_(bin_doctype)
        .select(bin_doctype.warehouse, bin_doctype.actual_qty)
        .where(bin_doctype.item_code == item_code)
        .where(bin_doctype.actual_qty > 0)
        .run(as_dict=True)
    )
    frappe.logger().info(f"DEBUG: All warehouses with stock for item {item_code}: {all_warehouses_for_item}")
    
    # Get available quantity in main warehouse
    available_qty = get_available_quantity(item_code, warehouse)
    frappe.logger().info(f"DEBUG: Available qty in {warehouse}: {available_qty}")
    
    # Get reserved quantity in "RESERVE - HW" warehouse
    reserve_warehouse = "RESERVE - HW"
    reserved_qty = get_reserved_quantity(item_code, reserve_warehouse)
    frappe.logger().info(f"DEBUG: Reserved qty in {reserve_warehouse}: {reserved_qty}")
    
    # Get Sales Invoice names that reserved this stock
    reserved_invoices = get_reserved_invoices(item_code, reserve_warehouse)
    frappe.logger().info(f"DEBUG: Reserved invoices: {reserved_invoices}")
    
    result = {
        "available_qty": available_qty,
        "reserved_qty": reserved_qty,
        "reserved_invoices": reserved_invoices
    }
    
    frappe.logger().info(f"DEBUG: Final result for {item_code}: {result}")
    
    return result


def get_available_quantity(item_code, warehouse):
    """Get available quantity for an item in the given warehouse."""
    bin_doctype = DocType("Bin")
    
    # Handle warehouse groups
    warehouses = [warehouse]
    if frappe.db.get_value("Warehouse", warehouse, "is_group"):
        warehouses = frappe.db.get_descendants("Warehouse", warehouse) or []
    
    # Get actual quantity (not projected quantity)
    result = (
        frappe.qb.from_(bin_doctype)
        .select(Sum(bin_doctype.actual_qty).as_("actual_qty"))
        .where(bin_doctype.item_code == item_code)
        .where(bin_doctype.warehouse.isin(warehouses))
        .run(as_dict=True)
    )
    
    actual_qty = float(result[0].actual_qty) if result and result[0].actual_qty else 0.0
    
    # Also try to get from item master if bin is empty
    if actual_qty == 0.0:
        # Check if item exists and has stock info
        item_doc = frappe.get_doc("Item", item_code)
        if item_doc:
            # For debugging: log the warehouse and item
            frappe.logger().info(f"Checking stock for item {item_code} in warehouse {warehouse}")
    
    return actual_qty


def get_reserved_quantity(item_code, reserve_warehouse):
    """Get reserved quantity for an item in the reserve warehouse."""
    bin_doctype = DocType("Bin")
    
    result = (
        frappe.qb.from_(bin_doctype)
        .select(Sum(bin_doctype.actual_qty).as_("actual_qty"))
        .where(bin_doctype.item_code == item_code)
        .where(bin_doctype.warehouse == reserve_warehouse)
        .run(as_dict=True)
    )
    
    return float(result[0].actual_qty) if result and result[0].actual_qty else 0.0


def get_reserved_invoices(item_code, reserve_warehouse):
    """Get list of Sales Invoice details that reserved stock for this item, sorted by latest first."""
    stock_entry_doctype = DocType("Stock Entry")
    stock_entry_item_doctype = DocType("Stock Entry Detail")
    sales_invoice_doctype = DocType("Sales Invoice")
    
    frappe.logger().info(f"DEBUG: Getting reserved invoices for item {item_code} in {reserve_warehouse}")
    
    # Get ALL Stock Entries for this item and see what we have
    all_entries = (
        frappe.qb.from_(stock_entry_doctype)
        .join(stock_entry_item_doctype)
        .on(stock_entry_doctype.name == stock_entry_item_doctype.parent)
        .select(
            stock_entry_doctype.name,
            stock_entry_doctype.posting_date,
            stock_entry_doctype.custom_sales_invoice,
            stock_entry_doctype.to_warehouse,
            stock_entry_doctype.from_warehouse,
            stock_entry_doctype.stock_entry_type
        )
        .where(stock_entry_doctype.docstatus == 1)
        .where(stock_entry_item_doctype.item_code == item_code)
        .where(stock_entry_doctype.stock_entry_type == "Material Transfer")
        .run(as_dict=True)
    )
    
    frappe.logger().info(f"DEBUG: All Stock Entries for {item_code}: {all_entries}")
    
    # For now, just return ANY non-empty custom_sales_invoice values
    # We'll worry about warehouse filtering later
    invoices = []
    for entry in all_entries:
        if entry.custom_sales_invoice and str(entry.custom_sales_invoice).strip():
            invoice_name = entry.custom_sales_invoice
            
            # Get Sales Invoice details
            invoice_details = (
                frappe.qb.from_(sales_invoice_doctype)
                .select(
                    sales_invoice_doctype.customer,
                    sales_invoice_doctype.due_date,
                    sales_invoice_doctype.posting_date
                )
                .where(sales_invoice_doctype.name == invoice_name)
                .where(sales_invoice_doctype.docstatus == 1)
                .run(as_dict=True)
            )
            
            invoice_info = {
                'invoice': invoice_name,
                'date': entry.posting_date,
                'to_warehouse': entry.to_warehouse
            }
            
            if invoice_details:
                detail = invoice_details[0]
                invoice_info.update({
                    'customer': detail.customer,
                    'due_date': detail.due_date,
                    'invoice_date': detail.posting_date
                })
            
            invoices.append(invoice_info)
    
    frappe.logger().info(f"DEBUG: Found invoices for {item_code}: {invoices}")
    
    # Sort by date (latest first)
    invoices.sort(key=lambda x: x.get('date', ''), reverse=True)
    
    frappe.logger().info(f"DEBUG: Final invoice details for {item_code}: {invoices}")
    
    return invoices


@frappe.whitelist()
def test_bin_data(item_code, warehouse):
    """Test function to check Bin table data for debugging."""
    bin_doctype = DocType("Bin")
    
    # Get all bin records for this item and warehouse
    result = (
        frappe.qb.from_(bin_doctype)
        .select(
            bin_doctype.warehouse,
            bin_doctype.actual_qty,
            bin_doctype.projected_qty,
            bin_doctype.reserved_qty,
            bin_doctype.ordered_qty,
            bin_doctype.planned_qty
        )
        .where(bin_doctype.item_code == item_code)
        .where(bin_doctype.warehouse == warehouse)
        .run(as_dict=True)
    )
    
    # Also get all warehouses for this item
    all_warehouses = (
        frappe.qb.from_(bin_doctype)
        .select(bin_doctype.warehouse, bin_doctype.actual_qty)
        .where(bin_doctype.item_code == item_code)
        .run(as_dict=True)
    )
    
    return {
        "specific_warehouse": result,
        "all_warehouses": all_warehouses,
        "item_exists": frappe.db.exists("Item", item_code),
        "warehouse_exists": frappe.db.exists("Warehouse", warehouse)
    }


@frappe.whitelist()
def get_bulk_reserved_stock_info(items_data):
    """
    Get reserved stock information for multiple items.
    
    Args:
        items_data: JSON string or list of dicts with item_code and warehouse
        
    Returns:
        dict: key=(item_code, warehouse), value=reserved_stock_info
    """
    import json
    
    if isinstance(items_data, str):
        items_data = json.loads(items_data)
    
    if not items_data:
        return {}
    
    results = {}
    
    for item_data in items_data:
        item_code = item_data.get("item_code")
        warehouse = item_data.get("warehouse")
        
        if not item_code or not warehouse:
            continue
            
        key = f"{item_code},{warehouse}"
        results[key] = get_reserved_stock_info(item_code, warehouse)
    
    return results
