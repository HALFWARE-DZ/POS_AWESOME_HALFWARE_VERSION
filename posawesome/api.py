import frappe

@frappe.whitelist()
def get_invoices_by_item_barcode(barcode):
    """Get all invoices that contain items with the specified barcode"""
    
    # Get Sales Invoice Items with the barcode
    items = frappe.db.get_all('Sales Invoice Item', 
        filters={'barcode': ['like', f'%{barcode}%'], 'docstatus': 1},
        fields=['parent'],
        limit=200
    )
    
    # Get Sales Invoice Items where item_code matches the barcode
    items_by_code = frappe.db.get_all('Sales Invoice Item', 
        filters={'item_code': ['like', f'%{barcode}%'], 'docstatus': 1},
        fields=['parent'],
        limit=200
    )
    
    # Combine and get unique parent names
    parent_names = set()
    for item in items:
        parent_names.add(item.parent)
    for item in items_by_code:
        parent_names.add(item.parent)
    
    # Convert to list
    invoice_names = list(parent_names)
    
    if not invoice_names:
        return []
    
    # Get full invoice details
    invoices = frappe.db.get_all('Sales Invoice',
        filters={'name': ['in', invoice_names], 'docstatus': 1, 'is_return': 0},
        fields=[
            'name', 'customer', 'posting_date', 'grand_total',
            'status', 'remarks', 'currency', 'outstanding_amount', 
            'custom_barcode', 'custom_is_reserve',
            'creation', 'modified', 'pos_profile', 'posa_pos_opening_shift'
        ],
        order_by='posting_date desc, creation desc',
        limit=200
    )
    
    return invoices

@frappe.whitelist()
def get_invoices_by_item_code(item_code):
    """Get all invoices that contain items with the specified item code"""
    
    # Get Sales Invoice Items with the item code
    items = frappe.db.get_all('Sales Invoice Item', 
        filters={'item_code': ['like', f'%{item_code}%'], 'docstatus': 1},
        fields=['parent'],
        limit=200
    )
    
    # Get unique parent names
    parent_names = set()
    for item in items:
        parent_names.add(item.parent)
    
    # Convert to list
    invoice_names = list(parent_names)
    
    if not invoice_names:
        return []
    
    # Get full invoice details
    invoices = frappe.db.get_all('Sales Invoice',
        filters={'name': ['in', invoice_names], 'docstatus': 1, 'is_return': 0},
        fields=[
            'name', 'customer', 'posting_date', 'grand_total',
            'status', 'remarks', 'currency', 'outstanding_amount', 
            'custom_barcode', 'custom_is_reserve',
            'creation', 'modified', 'pos_profile', 'posa_pos_opening_shift'
        ],
        order_by='posting_date desc, creation desc',
        limit=200
    )
    
    return invoices
