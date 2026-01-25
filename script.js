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

// Toggle between login and sign-up forms
function toggleForm(event) {
    event.preventDefault();
    
    const loginForm = document.getElementById("loginForm");
    const signupForm = document.getElementById("signupForm");
    const headerTitle = document.getElementById("headerTitle");
    const headerSubtitle = document.getElementById("headerSubtitle");
    const toggleText = document.getElementById("toggleText");
    const messageDiv = document.getElementById("message");
    const signupMessageDiv = document.getElementById("signupMessage");
    
    // Clear messages
    messageDiv.style.display = "none";
    signupMessageDiv.style.display = "none";
    
    if (loginForm.style.display === "none") {
        // Show login form
        loginForm.style.display = "block";
        signupForm.style.display = "none";
        headerTitle.textContent = "Welcome Back";
        headerSubtitle.textContent = "Sign in to your account";
        toggleText.innerHTML = 'Don\'t have an account? <a href="#" onclick="toggleForm(event)">Sign up</a>';
    } else {
        // Show sign-up form
        loginForm.style.display = "none";
        signupForm.style.display = "block";
        headerTitle.textContent = "Create Account";
        headerSubtitle.textContent = "Sign up to get started";
        toggleText.innerHTML = 'Already have an account? <a href="#" onclick="toggleForm(event)">Sign in</a>';
    }
}

// Handle sign-up form submission
function handleSignup(event) {
    event.preventDefault();
    
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const role = document.getElementById("userRole").value;
    const messageDiv = document.getElementById("signupMessage");
    const btnText = document.getElementById("signupBtnText");
    const btnLoader = document.getElementById("signupBtnLoader");
    const signupForm = document.getElementById("signupForm");
    const signupBtn = signupForm.querySelector(".login-btn");
    
    // Clear previous messages
    messageDiv.className = "message";
    messageDiv.textContent = "";
    messageDiv.style.display = "none";
    
    // Validate passwords match
    if (password !== confirmPassword) {
        messageDiv.className = "message error";
        messageDiv.textContent = "Passwords do not match";
        messageDiv.style.display = "block";
        return;
    }
    
    // Validate password length
    if (password.length < 6) {
        messageDiv.className = "message error";
        messageDiv.textContent = "Password must be at least 6 characters long";
        messageDiv.style.display = "block";
        return;
    }
    
    // Validate role
    if (!role) {
        messageDiv.className = "message error";
        messageDiv.textContent = "Please select a role";
        messageDiv.style.display = "block";
        return;
    }
    
    // Show loading state
    signupBtn.disabled = true;
    btnText.style.display = "none";
    btnLoader.style.display = "block";
    
    // Send sign-up request
    fetch("http://localhost:3000/register", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password, role })
    })
    .then(res => res.json())
    .then(data => {
        // Reset button state
        signupBtn.disabled = false;
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
            messageDiv.textContent = data.message || "Registration failed. Please try again.";
            messageDiv.style.display = "block";
        }
    })
    .catch(error => {
        // Reset button state
        signupBtn.disabled = false;
        btnText.style.display = "block";
        btnLoader.style.display = "none";
        
        // Show error message
        messageDiv.className = "message error";
        messageDiv.textContent = "Server error. Please make sure the server is running.";
        messageDiv.style.display = "block";
        console.error("Sign-up error:", error);
    });
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
