// Handle login form submission
function handleLogin(event) {
    event.preventDefault();
    
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const messageDiv = document.getElementById("message");
    const btnText = document.getElementById("btnText");
    const btnLoader = document.getElementById("btnLoader");
    const loginBtn = document.querySelector(".login-btn");
    
    // Clear previous messages
    messageDiv.className = "message";
    messageDiv.textContent = "";
    messageDiv.style.display = "none";
    
    // Show loading state
    loginBtn.disabled = true;
    btnText.style.display = "none";
    btnLoader.style.display = "block";
    
    // Send login request
    fetch("http://localhost:3000/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
    })
    .then(res => res.json())
    .then(data => {
        // Reset button state
        loginBtn.disabled = false;
        btnText.style.display = "block";
        btnLoader.style.display = "none";
        
        if (data.success) {
            // Show success message
            messageDiv.className = "message success";
            messageDiv.textContent = data.message;
            messageDiv.style.display = "block";
            
            // Store user data in sessionStorage
            sessionStorage.setItem("user", JSON.stringify(data.user));
            
            // Redirect to dashboard after short delay
            setTimeout(() => {
                showDashboard(data.user);
            }, 1000);
        } else {
            // Show error message
            messageDiv.className = "message error";
            messageDiv.textContent = data.message || "Login failed. Please try again.";
            messageDiv.style.display = "block";
        }
    })
    .catch(error => {
        // Reset button state
        loginBtn.disabled = false;
        btnText.style.display = "block";
        btnLoader.style.display = "none";
        
        // Show error message
        messageDiv.className = "message error";
        messageDiv.textContent = "Server error. Please make sure the server is running.";
        messageDiv.style.display = "block";
        console.error("Login error:", error);
    });
}

// Show dashboard based on user role
function showDashboard(user) {
    const loginBox = document.querySelector(".login-box");
    const dashboard = document.getElementById("dashboard");
    const userEmail = document.getElementById("userEmail");
    const roleBadge = document.getElementById("roleBadge");
    const roleContent = document.getElementById("roleContent");
    
    // Hide login form
    loginBox.style.display = "none";
    
    // Show dashboard
    dashboard.style.display = "block";
    
    // Set user information
    userEmail.textContent = user.email;
    roleBadge.textContent = user.role;
    roleBadge.className = `role-badge ${user.role}`;
    
    // Set role-specific content
    roleContent.innerHTML = getRoleContent(user.role);
}

// Get role-specific dashboard content
function getRoleContent(role) {
    const content = {
        admin: `
            <h4>Admin Dashboard</h4>
            <p>You have full administrative access to the system.</p>
            <ul>
                <li>Manage all users and their roles</li>
                <li>Access all system settings</li>
                <li>View and modify all events and participants</li>
                <li>Generate system reports</li>
                <li>Configure system-wide permissions</li>
            </ul>
        `,
        organizer: `
            <h4>Organizer Dashboard</h4>
            <p>You can manage events and participants.</p>
            <ul>
                <li>Create and manage events</li>
                <li>View and manage participants</li>
                <li>Send notifications to participants</li>
                <li>Generate event reports</li>
                <li>Manage event registrations</li>
            </ul>
        `,
        participant: `
            <h4>Participant Dashboard</h4>
            <p>Welcome! You can participate in events.</p>
            <ul>
                <li>View available events</li>
                <li>Register for events</li>
                <li>View your event history</li>
                <li>Update your profile</li>
                <li>Receive event notifications</li>
            </ul>
        `
    };
    
    return content[role] || "<p>Welcome to your dashboard!</p>";
}

// Logout function
function logout() {
    // Clear session storage
    sessionStorage.removeItem("user");
    
    // Hide dashboard
    document.getElementById("dashboard").style.display = "none";
    
    // Show login form
    document.querySelector(".login-box").style.display = "block";
    
    // Clear form
    document.getElementById("loginForm").reset();
    document.getElementById("message").style.display = "none";
}

// Check if user is already logged in on page load
window.addEventListener("DOMContentLoaded", () => {
    const userData = sessionStorage.getItem("user");
    if (userData) {
        try {
            const user = JSON.parse(userData);
            showDashboard(user);
        } catch (error) {
            console.error("Error parsing user data:", error);
            sessionStorage.removeItem("user");
        }
    }
});
