import frappe
from frappe import _
from frappe.utils import flt

@frappe.whitelist()
def complete_reservation(reservation_invoice_name, payments_data):
    """
    Complete a reservation by:
    1. Updating payment on original invoice
    2. Creating Stock Entry to deliver from RESERVE
    3. Marking as completed
    """
    
    # Get the reservation invoice
    reservation = frappe.get_doc("Sales Invoice", reservation_invoice_name)
    
    if not reservation.custom_is_reserve:
        frappe.throw(_("This is not a reservation invoice"))
    
    if reservation.custom_reservation_status == "Completed":
        frappe.throw(_("This reservation is already completed"))
    
    if reservation.custom_reservation_status == "Expired":
        frappe.throw(_("This reservation has expired"))
    
    try:
        # Parse payments data (comes from POSAwesome payment screen)
        import json
        if isinstance(payments_data, str):
            payments_data = json.loads(payments_data)
        
        # Update payments on original reservation invoice
        # Clear old payments and add new complete payment
        reservation.payments = []
        for payment in payments_data:
            reservation.append("payments", payment)
        
        # Calculate new paid amount
        total_paid = sum(flt(p.get('amount', 0)) for p in payments_data)
        reservation.paid_amount = total_paid
        reservation.base_paid_amount = total_paid
        reservation.outstanding_amount = flt(reservation.grand_total) - total_paid
        
        # Save updated payments
        reservation.flags.ignore_validate_update_after_submit = True
        reservation.save()
        
        # Create Stock Entry: RESERVE → OUT (customer delivery)
        se = frappe.new_doc("Stock Entry")
        se.stock_entry_type = "Material Issue"  # Issue stock (not transfer)
        se.set_posting_time = 1
        se.company = reservation.company
        se.custom_sales_invoice = reservation_invoice_name
        
        for item in reservation.items:
            valuation_rate = frappe.db.get_value(
                "Bin",
                {"item_code": item.item_code, "warehouse": "RESERVE - MT"},
                "valuation_rate"
            ) or item.rate or 1
            
            se.append("items", {
                "item_code": item.item_code,
                "s_warehouse": "RESERVE - MT",  # From reserve, no target (delivered to customer)
                "qty": item.qty,
                "uom": item.uom,
                "basic_rate": valuation_rate,
                "cost_center": frappe.db.get_value("Company", reservation.company, "cost_center")
            })
        
        se.remarks = f"Delivering reserved items for {reservation_invoice_name}"
        se.insert()
        se.submit()
        
        # Mark reservation as completed
        frappe.db.set_value("Sales Invoice", reservation_invoice_name, "custom_reservation_status", "Completed")
        frappe.db.commit()
        
        return {
            "status": "success",
            "invoice": reservation_invoice_name,
            "stock_entry": se.name,
            "message": f"Reservation completed: {reservation_invoice_name}"
        }
        
    except Exception as e:
        frappe.log_error(f"Failed to complete reservation {reservation_invoice_name}: {str(e)}")
        frappe.throw(_("Failed to complete reservation: {0}").format(str(e)))

