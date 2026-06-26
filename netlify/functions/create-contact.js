// netlify/functions/create-contact.js
// This runs server-side so your API key stays secret.

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ message: "Method not allowed" }) };
  }

  const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;

  if (!HUBSPOT_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ message: "API key not configured" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ message: "Invalid request body" }) };
  }

  const { firstname, lastname, email, company, phone } = body;

  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ message: "Email is required" }) };
  }

  // Build the properties object — only include fields that have a value
  const properties = { email };
  if (firstname) properties.firstname = firstname;
  if (lastname)  properties.lastname  = lastname;
  if (company)   properties.company   = company;
  if (phone)     properties.phone     = phone;

  try {
    const response = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${HUBSPOT_API_KEY}`,
      },
      body: JSON.stringify({ properties }),
    });

    const data = await response.json();

    if (response.ok) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Contact created", id: data.id }),
      };
    }

    // HubSpot error — surface the message
    const hsMessage = data?.message || "HubSpot returned an error";
    return {
      statusCode: response.status,
      body: JSON.stringify({ message: hsMessage }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Server error: " + err.message }),
    };
  }
};
