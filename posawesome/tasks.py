import frappe
from frappe.utils import nowdate, getdate

def expire_old_reservations():
    """Check for expired reservations and auto-return stock"""
    
    # Find all submitted reservation invoices that are past due date
    expired_reservations = frappe.get_all(
        "Sales Invoice",
        filters={
            "custom_is_reserve": 1,
            "docstatus": 1,  # Submitted only
            "due_date": ["<", nowdate()],  # Past due date
            "custom_reservation_status": ["in", ["Reserved", None]]  # Not already returned
        },
        fields=["name", "due_date", "company"]
    )
    
    for reservation in expired_reservations:
        try:
            # Create Stock Entry to return items from RESERVE to original warehouse
            invoice = frappe.get_doc("Sales Invoice", reservation.name)
            
            se = frappe.new_doc("Stock Entry")
            se.stock_entry_type = "Material Transfer"
            se.set_posting_time = 1
            se.company = invoice.company
            se.custom_sales_invoice = invoice.name
            se.custom_is_auto_expired = 1  # Mark as auto-expired
            
            for item in invoice.items:
                # Get valuation rate from RESERVE warehouse
                valuation_rate = frappe.db.get_value(
                    "Bin",
                    {
                        "item_code": item.item_code,
                        "warehouse": "RESERVE - HW"
                    },
                    "valuation_rate"
                ) or item.rate or 1
                
                se.append("items", {
                    "item_code": item.item_code,
                    "s_warehouse": "RESERVE - HW",      # From reserve
                    "t_warehouse": item.warehouse,      # Back to original (Finished Goods)
                    "qty": item.qty,                   # Positive qty
                    "uom": item.uom,
                    "basic_rate": valuation_rate
                })
            
            se.remarks = f"Auto-expired reservation {invoice.name} (due: {invoice.due_date})"
            se.insert()
            se.submit()
            
            # Update reservation status
            frappe.db.set_value("Sales Invoice", invoice.name, "custom_reservation_status", "Expired")
            
            frappe.logger().info(f"Auto-expired reservation: {invoice.name}")
            
        except Exception as e:
            frappe.logger().error(f"Failed to expire reservation {reservation.name}: {str(e)}")
            continue

