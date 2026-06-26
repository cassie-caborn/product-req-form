// netlify/functions/setup-hubspot.js
// Run this ONCE to create all missing HubSpot properties.
// Visit: https://your-site.netlify.app/.netlify/functions/setup-hubspot
// After running successfully, you can delete this file.

exports.handler = async () => {
  const KEY = process.env.HUBSPOT_API_KEY;
  if (!KEY) return resp(500, { error: 'HUBSPOT_API_KEY not set' });

  const headers = {
    'Authorization': `Bearer ${KEY}`,
    'Content-Type': 'application/json'
  };

  const results = [];

  async function createProperty(objectType, property) {
    const res = await fetch(`https://api.hubapi.com/crm/v3/properties/${objectType}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(property)
    });
    const data = await res.json();
    if (res.ok) {
      results.push({ status: 'created', objectType, name: property.name });
    } else if (data.message && data.message.includes('already exists')) {
      results.push({ status: 'already_exists', objectType, name: property.name });
    } else {
      results.push({ status: 'error', objectType, name: property.name, error: data.message });
    }
  }

  // ── DEAL PROPERTIES ─────────────────────────────────────────────────────────

  await createProperty('deals', {
    name: 'pv_sunscreen_type',
    label: 'Sunscreen Type',
    type: 'enumeration',
    fieldType: 'select',
    groupName: 'dealinformation',
    description: 'Type of sunscreen formula requested.',
    options: [
      { label: 'Mineral (Zinc Oxide)', value: 'mineral', displayOrder: 1 },
      { label: 'Chemical', value: 'chemical', displayOrder: 2 },
      { label: 'Hybrid (Mineral + Chemical)', value: 'hybrid', displayOrder: 3 },
      { label: 'Tinted Mineral', value: 'tinted_mineral', displayOrder: 4 },
      { label: 'Sport / Water-resistant', value: 'sport_water_resistant', displayOrder: 5 },
      { label: 'Daily Moisturizer SPF', value: 'daily_moisturizer', displayOrder: 6 },
      { label: 'Other', value: 'other', displayOrder: 7 }
    ]
  });

  await createProperty('deals', {
    name: 'pv_unit_quantity',
    label: 'Unit Quantity',
    type: 'number',
    fieldType: 'number',
    groupName: 'dealinformation',
    description: 'Estimated unit quantity per SKU.'
  });

  await createProperty('deals', {
    name: 'pv_duns_number',
    label: 'DUNS Number',
    type: 'string',
    fieldType: 'text',
    groupName: 'dealinformation',
    description: '9-digit unique business identifier.'
  });

  await createProperty('deals', {
    name: 'pv_labeler_code',
    label: 'Labeler Code',
    type: 'string',
    fieldType: 'text',
    groupName: 'dealinformation',
    description: 'FDA labeler code if applicable.'
  });

  await createProperty('deals', {
    name: 'pv_preferred_contact',
    label: 'Preferred Contact Method',
    type: 'enumeration',
    fieldType: 'select',
    groupName: 'dealinformation',
    description: 'How the contact prefers to be reached.',
    options: [
      { label: 'Email', value: 'email', displayOrder: 1 },
      { label: 'Phone', value: 'phone', displayOrder: 2 },
      { label: 'Video call', value: 'video_call', displayOrder: 3 }
    ]
  });

  await createProperty('deals', {
    name: 'pv_packaging_notes',
    label: 'Packaging Notes',
    type: 'string',
    fieldType: 'textarea',
    groupName: 'dealinformation',
    description: 'Additional packaging inspiration or notes.'
  });

  await createProperty('deals', {
    name: 'pv_spf_label',
    label: 'SPF Rating (Label)',
    type: 'string',
    fieldType: 'text',
    groupName: 'dealinformation',
    description: 'SPF rating as entered by client e.g. SPF 50+.'
  });

  // ── CONTACT PROPERTIES ───────────────────────────────────────────────────────

  await createProperty('contacts', {
    name: 'pv_duns_number',
    label: 'DUNS Number',
    type: 'string',
    fieldType: 'text',
    groupName: 'contactinformation',
    description: '9-digit unique business identifier.'
  });

  await createProperty('contacts', {
    name: 'pv_labeler_code',
    label: 'Labeler Code',
    type: 'string',
    fieldType: 'text',
    groupName: 'contactinformation',
    description: 'FDA labeler code if applicable.'
  });

  await createProperty('contacts', {
    name: 'pv_preferred_contact',
    label: 'Preferred Contact Method',
    type: 'enumeration',
    fieldType: 'select',
    groupName: 'contactinformation',
    description: 'How the contact prefers to be reached.',
    options: [
      { label: 'Email', value: 'email', displayOrder: 1 },
      { label: 'Phone', value: 'phone', displayOrder: 2 },
      { label: 'Video call', value: 'video_call', displayOrder: 3 }
    ]
  });

  const created = results.filter(r => r.status === 'created').length;
  const existing = results.filter(r => r.status === 'already_exists').length;
  const errors = results.filter(r => r.status === 'error');

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: `${created} created, ${existing} already existed, ${errors.length} errors`,
      results
    }, null, 2)
  };
};

function resp(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
