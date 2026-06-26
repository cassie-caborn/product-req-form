// netlify/functions/submit-requirements.js
// Receives the product requirements form, creates/updates HubSpot contact
// and deal, and writes all fields with correct enum values.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resp(405, { error: 'Method not allowed' });
  }

  const KEY = process.env.HUBSPOT_API_KEY;
  if (!KEY) return resp(500, { error: 'HUBSPOT_API_KEY not set' });

  let data;
  try { data = JSON.parse(event.body); }
  catch { return resp(400, { error: 'Invalid JSON' }); }

  const { email, firstName, lastName, company, phone,
          contactMethod, duns, labelerCode, address, products } = data;

  if (!email) return resp(400, { error: 'Email is required' });

  const headers = {
    'Authorization': `Bearer ${KEY}`,
    'Content-Type': 'application/json'
  };

  // ── ENUM CONVERSION MAPS ─────────────────────────────────────────────────────
  // HubSpot stores internal values (snake_case); form sends human labels.

  const SUNSCREEN_MAP = {
    'Mineral (Zinc Oxide)':       'mineral',
    'Chemical':                   'chemical',
    'Hybrid (Mineral + Chemical)':'hybrid',
    'Tinted Mineral':             'tinted_mineral',
    'Sport / Water-resistant':    'sport_water_resistant',
    'Daily moisturizer SPF':      'daily_moisturizer',
    'Other':                      'other'
  };

  const CONTAINER_MAP = {
    'Bottle':         'bottle',
    'Tube':           'tube',
    'Pump bottle':    'pump_bottle',
    'Stick':          'stick',
    'Jar':            'jar',
    'Sachet / Pouch': 'sachet_pouch',
    'Aerosol can':    'aerosol_can',
    'Other':          'other'
  };

  const CLOSURE_MAP = {
    'Flip-top cap':   'flip_top_cap',
    'Disc cap':       'disc_cap',
    'Pump':           'pump',
    'Twist cap':      'twist_cap',
    'Screw cap':      'screw_cap',
    'Press-lock cap': 'press_lock_cap',
    'Other':          'other'
  };

  const DECORATION_MAP = {
    'Custom label':    'custom_label',
    'Silkscreen print':'silkscreen_print',
    'Hot stamp':       'hot_stamp',
    'Emboss / Deboss': 'emboss_deboss',
    'Shrink sleeve':   'shrink_sleeve',
    'No decoration':   'no_decoration'
  };

  const SHIPPING_MAP = {
    'DDP (Delivered Duty Paid)': 'ddp_delivered_duty_paid',
    'EXW (Ex Works)':            'exw_ex_works',
    'FOB (Free on Board)':       'fob_free_on_board',
    'CIF':                       'cif',
    'Other':                     'other'
  };

  const MFG_MAP = {
    'USA Manufacturing':   'usa_manufacturing',
    'China Manufacturing': 'china_manufacturing'
  };

  const CONTACT_MAP = {
    'Email':      'email',
    'Phone':      'phone',
    'Video call': 'video_call'
  };

  // Convert a human label to HubSpot internal value, or pass through if unknown
  function toEnum(map, value) {
    if (!value) return '';
    // Handle "Other: custom text" format — store as plain text, strip prefix
    if (value.startsWith('Other: ')) return 'other';
    return map[value] || value;
  }

  // Extract numeric SPF value from label like "SPF 50+" → 50
  function spfToNumber(value) {
    if (!value) return null;
    const match = value.match(/\d+/);
    return match ? parseInt(match[0]) : null;
  }

  try {
    // ── STEP 1: Create or update contact ──────────────────────────────────────

    const searchRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
        properties: ['email', 'firstname', 'lastname'],
        limit: 1
      })
    });
    const searchData = await searchRes.json();
    let contactId;

    const contactProps = {
      email,
      firstname:           firstName  || '',
      lastname:            lastName   || '',
      company:             company    || '',
      phone:               phone      || '',
      address:             address    || '',
      pv_preferred_contact: toEnum(CONTACT_MAP, contactMethod),
      pv_duns_number:      duns       || '',
      pv_labeler_code:     labelerCode|| ''
    };

    if (searchData.total > 0) {
      contactId = searchData.results[0].id;
      await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ properties: contactProps })
      });
    } else {
      const createRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST', headers,
        body: JSON.stringify({ properties: contactProps })
      });
      const newContact = await createRes.json();
      contactId = newContact.id;
      if (!contactId) {
        console.error('Contact creation failed:', JSON.stringify(newContact));
        return resp(500, { error: 'Failed to create contact: ' + (newContact.message || 'unknown error') });
      }
    }

    // ── STEP 2: Find or create deal ───────────────────────────────────────────

    const dealsRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/deals`,
      { method: 'GET', headers }
    );
    const dealsData = await dealsRes.json();
    let dealId;

    if (dealsData.results && dealsData.results.length > 0) {
      // Use the most recent open deal
      dealId = dealsData.results[dealsData.results.length - 1].id;
    } else {
      // No deal exists — create one in New Inquiry stage
      const createDealRes = await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
        method: 'POST', headers,
        body: JSON.stringify({
          properties: {
            dealname:   `${company} — New Inquiry`,
            pipeline:   'default',
            dealstage:  '3395275456'   // New Inquiry
          },
          associations: [{
            to: { id: contactId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
          }]
        })
      });
      const newDeal = await createDealRes.json();
      dealId = newDeal.id;
      if (!dealId) {
        console.error('Deal creation failed:', JSON.stringify(newDeal));
        return resp(500, { error: 'Failed to create deal: ' + (newDeal.message || 'unknown error') });
      }
    }

    // ── STEP 3: Write Product 1 fields to deal properties ─────────────────────

    const p1 = (products && products[0]) || {};
    const spfNum = spfToNumber(p1.spf);

    const dealProperties = {
      // Contact-level fields mirrored on deal for easy access
      pv_duns_number:       duns        || '',
      pv_labeler_code:      labelerCode || '',
      pv_preferred_contact: toEnum(CONTACT_MAP, contactMethod),

      // Product 1 fields
      pv_product_name:      p1.name     || '',
      pv_sunscreen_type:    toEnum(SUNSCREEN_MAP, p1.sunscreenType),
      pv_spf_label:         p1.spf      || '',   // human label e.g. "SPF 50+"
      pv_unit_quantity:     p1.unitQty  ? String(parseInt(p1.unitQty)) : '',
      fill_size:            p1.fillSize || '',
      claims_desired:       p1.claims   || '',
      pv_target_launch_date: '',                  // date field — see note below
      manufacturing_location: toEnum(MFG_MAP, p1.manufacturingLocation),
      container_type:       toEnum(CONTAINER_MAP,   p1.container),
      closure_type:         toEnum(CLOSURE_MAP,     p1.closure),
      decoration_type:      toEnum(DECORATION_MAP,  p1.decoration),
      shipping_terms:       toEnum(SHIPPING_MAP,    p1.shipping),
      artwork_notes:        p1.artwork  || ''
    };

    // pv_spf_target is a number field — only set if we got a valid number
    if (spfNum !== null) dealProperties.pv_spf_target = String(spfNum);

    // pv_target_launch_date is a date field (YYYY-MM-DD).
    // The form sends freetext like "Q3 2026" so we skip it here and log it in the note.
    delete dealProperties.pv_target_launch_date;

    // Remove empty strings from enum fields to avoid HubSpot validation errors
    const enumFields = ['pv_sunscreen_type','manufacturing_location','container_type',
                        'closure_type','decoration_type','shipping_terms','pv_preferred_contact'];
    enumFields.forEach(f => { if (!dealProperties[f]) delete dealProperties[f]; });

    const updateRes = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ properties: dealProperties })
    });
    const updateData = await updateRes.json();
    if (!updateRes.ok) {
      console.error('Deal update failed:', JSON.stringify(updateData));
      // Don't abort — still log the note
    }

    // ── STEP 4: Log all products as a formatted note ──────────────────────────

    const noteLines = (products || []).map((p, i) => [
      `── PRODUCT ${i + 1}: ${p.name || 'Unnamed'} ──`,
      `  Sunscreen Type:       ${p.sunscreenType || '-'}`,
      `  SPF Rating:           ${p.spf || '-'}`,
      `  Unit Quantity:        ${p.unitQty || '-'}`,
      `  Fill Size:            ${p.fillSize || '-'}`,
      `  Claims Desired:       ${p.claims || '-'}`,
      `  Launch Date:          ${p.launchDate || '-'}`,
      `  Manufacturing:        ${p.manufacturingLocation || '-'}`,
      `  Container:            ${p.container || '-'}`,
      `  Closure:              ${p.closure || '-'}`,
      `  Decoration:           ${p.decoration || '-'}`,
      `  Shipping Terms:       ${p.shipping || '-'}`,
      `  Artwork Notes:        ${p.artwork || '-'}`,
      `  File uploads:         ${Object.entries(p.uploads || {}).map(([cat, files]) => `${cat}: ${files.join(', ') || 'none'}`).join(' | ')}`
    ].join('\n')).join('\n\n');

    const noteBody = [
      `Product Requirements Form — Submitted ${new Date().toUTCString()}`,
      ``,
      `CONTACT`,
      `  Name:           ${firstName} ${lastName}`,
      `  Email:          ${email}`,
      `  Phone:          ${phone || '-'}`,
      `  Company:        ${company}`,
      `  Address:        ${address || '-'}`,
      `  DUNS #:         ${duns || '-'}`,
      `  Labeler Code:   ${labelerCode || '-'}`,
      `  Contact Pref:   ${contactMethod || '-'}`,
      ``,
      `PRODUCTS (${(products || []).length} SKU${(products || []).length !== 1 ? 's' : ''})`,
      noteLines
    ].join('\n');

    await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
      method: 'POST', headers,
      body: JSON.stringify({
        properties: {
          hs_note_body:  noteBody,
          hs_timestamp:  new Date().toISOString()
        },
        associations: [
          { to: { id: dealId },    types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }] },
          { to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }
        ]
      })
    });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, contactId, dealId })
    };

  } catch (err) {
    console.error('submit-requirements error:', err);
    return resp(500, { error: 'Server error: ' + err.message });
  }
};

function resp(status, body) {
  return {
    statusCode: status,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
