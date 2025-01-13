// Wait for form submission
document.getElementById('customerForm').addEventListener('submit', async (event) => {
    event.preventDefault();  // Prevent the form from reloading the page
  
    // Collect form data
    const customerData = {
      name: document.getElementById('name').value,
      email: document.getElementById('email').value,
      phone: document.getElementById('phone').value,
      payment_type: document.getElementById('payment_type').value,
      payment_amount: parseFloat(document.getElementById('payment_amount').value),
    };
  
    try {
      // Send the data to the backend using fetch()
      const response = await fetch('http://localhost:3000/add-customer', {
        method: 'POST', // HTTP method
        headers: { 'Content-Type': 'application/json' }, // Send JSON data
        body: JSON.stringify(customerData), // Convert object to JSON
      });
  
      // Get the response text
      const result = await response.text();
  
      // Display the response
      document.getElementById('response').innerText = result;
    } catch (error) {
      console.error('Error:', error);
      document.getElementById('response').innerText = 'Failed to add customer.';
    }
  });
  