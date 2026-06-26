exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;

  if (!HUBSPOT_API_KEY) {
    console.error('HUBSPOT_API_KEY environment variable is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { email, firstName, lastName, company, phone, contactMethod, duns, labelerCode, address, products } = data;

  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email is required' }) };
  }

  const headers = {
    'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    // Step 1: Look up contact by email
    const searchRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filterGroups: [{
          filters: [{ propertyName: 'email', operator: 'EQ', value: email }]
        }],
        properties: ['firstname', 'lastname', 'email', 'phone', 'company'],
        limit: 1
      })
    });

    const searchData = await searchRes.json();
    let contactId;

    if (searchData.total > 0) {
      // Contact exists — update it
      contactId = searchData.results[0].id;
      await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          properties: {
            firstname: firstName,
            lastname: lastName,
            company: company,
            phone: phone || '',
            address: address || '',
            pv_preferred_contact: contactMethod || '',
            pv_duns_number: duns || '',
            pv_labeler_code: labelerCode || ''
          }
        })
      });
    } else {
      // Contact does not exist — create it
      const createContactRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            email,
            firstname: firstName,
            lastname: lastName,
            company: company,
            phone: phone || '',
            address: address || '',
            pv_preferred_contact: contactMethod || '',
            pv_duns_number: duns || '',
            pv_labeler_code: labelerCode || ''
          }
        })
      });
      const newContact = await createContactRes.json();
      contactId = newContact.id;
    }

    // Step 2: Find deals associated with this contact
    const dealsRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/deals`,
      { method: 'GET', headers }
    );
    const dealsData = await dealsRes.json();

    let dealId;

    if (dealsData.results && dealsData.results.length > 0) {
      // Use the most recently created deal (last in list)
      dealId = dealsData.results[dealsData.results.length - 1].id;
    } else {
      // No deal exists — create one
      const product1 = products && products[0];
      const createDealRes = await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            dealname: `${company} — New Inquiry`,
            pipeline: 'default',
            dealstage: 'appointmentscheduled',
            hubspot_owner_id: ''
          },
          associations: [{
            to: { id: contactId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
          }]
        })
      });
      const newDeal = await createDealRes.json();
      dealId = newDeal.id;
    }

    // Step 3: Build deal properties from first product
    // For multi-SKU submissions we write product 1 to deal fields
    // and append all products as a formatted note
    const p1 = products && products[0] ? products[0] : {};

    const dealProperties = {
      pv_product_name: p1.name || '',
      pv_sunscreen_type: p1.sunscreenType || '',
      pv_spf_target: p1.spf || '',
      pv_unit_quantity: p1.unitQty || '',
      fill_size: p1.fillSize || '',
      claims_desired: p1.claims || '',
      pv_target_launch_date: p1.launchDate || '',
      container_type: p1.container || '',
      closure_type: p1.closure || '',
      decoration_type: p1.decoration || '',
      shipping_terms: p1.shipping || '',
      artwork_notes: p1.artwork || '',
      manufacturing_location: p1.manufacturingLocation || ''
    };

    // Update the deal
    await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ properties: dealProperties })
    });

    // Step 4: If multiple products, log all of them as a note on the deal
    if (products && products.length > 0) {
      const noteLines = products.map((p, i) => {
        return [
          `PRODUCT ${i + 1}: ${p.name || 'Unnamed'}`,
          `  Type: ${p.sunscreenType || '-'}`,
          `  SPF: ${p.spf || '-'}`,
          `  Quantity: ${p.unitQty || '-'}`,
          `  Fill size: ${p.fillSize || '-'}`,
          `  Claims: ${p.claims || '-'}`,
          `  Launch date: ${p.launchDate || '-'}`,
          `  Container: ${p.container || '-'}`,
          `  Closure: ${p.closure || '-'}`,
          `  Decoration: ${p.decoration || '-'}`,
          `  Shipping: ${p.shipping || '-'}`,
          `  Artwork notes: ${p.artwork || '-'}`,
          `  Manufacturing: ${p.manufacturingLocation || '-'}`
        ].join('\n');
      }).join('\n\n');

      const noteBody = `Product Requirements Form Submission\nSubmitted: ${new Date().toISOString()}\n\nContact: ${firstName} ${lastName} | ${email} | ${company}\nAddress: ${address || '-'}\nDUNS: ${duns || '-'} | Labeler Code: ${labelerCode || '-'}\n\n${noteLines}`;

      await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            hs_note_body: noteBody,
            hs_timestamp: new Date().toISOString()
          },
          associations: [
            { to: { id: dealId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }] },
            { to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }
          ]
        })
      });
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, contactId, dealId })
    };

  } catch (err) {
    console.error('HubSpot integration error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Submission failed. Please try again.' })
    };
  }
};
