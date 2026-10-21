import { supabase } from "./supabase.js";

// Tells the safety-net script in admin.html that this module loaded.
window.__livinHolicAdminReady = true;

const $ = (id) => document.getElementById(id);

const loginSection = $("loginSection");
const dashboardSection = $("dashboardSection");
const loginForm = $("loginForm");
const productForm = $("productForm");
const productList = $("productList");

let currentUser = null;
let existingImageUrl = "";
let allProducts = [];

// ============================================
// MESSAGES
// ============================================

function showMessage(elementId, message, type = "") {
    const element = $(elementId);

    if (!element) {
        console.warn(message);
        return;
    }

    element.textContent = message;
    element.className = "message" + (type ? " " + type : "");
    element.classList.remove("hidden");
}

function hideMessage(elementId) {
    const element = $(elementId);

    if (element) {
        element.classList.add("hidden");
    }
}

// Shows any unexpected error on the page instead of failing silently.
function reportUnexpectedError(reason) {
    console.error(reason);

    const text = (reason && reason.message) ? reason.message : String(reason);
    const target = dashboardSection.classList.contains("hidden")
        ? "loginMessage"
        : "dashboardMessage";

    showMessage(target, "Unexpected error: " + text, "error");
}

window.addEventListener("unhandledrejection", (event) => {
    reportUnexpectedError(event.reason);
});

window.addEventListener("error", (event) => {
    reportUnexpectedError(event.error || event.message);
});

// ============================================
// SECURITY AND FORMATTING HELPERS
// ============================================

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, (character) => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return entities[character];
    });
}

function makeSlug(value) {
    const base = value
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return base || "product";
}

function safeExternalUrl(value) {
    try {
        const url = new URL(value);

        if (url.protocol === "https:" || url.protocol === "http:") {
            return url.href;
        }

        return null;
    } catch {
        return null;
    }
}

function setLoggedIn(isLoggedIn) {
    loginSection.classList.toggle("hidden", isLoggedIn);
    dashboardSection.classList.toggle("hidden", !isLoggedIn);
}

// Turns Supabase's technical sign-in errors into messages that say what to do.
function friendlyAuthError(error) {
    const text = error && error.message
        ? error.message
        : "Unknown error. Please try again.";

    if (/invalid login credentials/i.test(text)) {
        return "Wrong email or password. Check them and try again.";
    }

    if (/email not confirmed/i.test(text)) {
        return "This email has not been confirmed. In Supabase go to " +
            "Authentication > Users, open this user and confirm the email " +
            "(or tick 'Auto Confirm User' when creating it).";
    }

    if (/failed to fetch|networkerror|load failed/i.test(text)) {
        return "Could not reach Supabase. Check your internet connection " +
            "and the SUPABASE_URL in js/supabase.js.";
    }

    return text;
}

// Works out the storage path of an image from its public URL, so old
// images can be removed when a product is deleted or its image replaced.
function storagePathFromUrl(url) {
    if (!url) return null;

    const marker = "/product-images/";
    const index = url.indexOf(marker);

    if (index === -1) return null;

    return decodeURIComponent(
        url.slice(index + marker.length).split("?")[0]
    );
}

async function removeStoredImage(url) {
    const path = storagePathFromUrl(url);

    if (!path) return;

    try {
        await supabase.storage.from("product-images").remove([path]);
    } catch (error) {
        // Best effort only. A leftover image must never block the main action.
        console.warn("Could not remove old image:", error);
    }
}

// ============================================
// VERIFY ADMINISTRATOR
// ============================================

async function verifyAdministrator() {
    showMessage("loginMessage", "Verifying administrator account...");

    try {
        const {
            data: { user },
            error: userError
        } = await supabase.auth.getUser();

        if (userError) {
            throw userError;
        }

        if (!user) {
            currentUser = null;
            setLoggedIn(false);

            showMessage(
                "loginMessage",
                "No authenticated user was found. Please sign in again.",
                "error"
            );

            return false;
        }

        const { data: admin, error: adminError } = await supabase
            .from("admin_profiles")
            .select("id, full_name")
            .eq("id", user.id)
            .maybeSingle();

        if (adminError) {
            throw new Error(
                "Administrator verification failed: " + adminError.message
            );
        }

        if (!admin) {
            currentUser = null;

            await supabase.auth.signOut();

            setLoggedIn(false);

            // A missing row and a row hidden by Row Level Security look
            // identical from here, so the message names both causes.
            showMessage(
                "loginMessage",
                "You signed in, but no administrator profile was found for this account. " +
                "Either the admin_profiles table has no row whose id equals this user's id " +
                "(Authentication > Users > copy the User UID), or Row Level Security on " +
                "admin_profiles does not let a signed-in user read their own row.",
                "error"
            );

            return false;
        }

        currentUser = user;

        hideMessage("loginMessage");
        setLoggedIn(true);

        showMessage(
            "dashboardMessage",
            "Welcome, " + (admin.full_name || user.email) + ".",
            "success"
        );

        await loadCategories();
        await loadProducts();

        return true;

    } catch (error) {
        currentUser = null;
        setLoggedIn(false);

        showMessage(
            "loginMessage",
            friendlyAuthError(error) || "Could not verify administrator access.",
            "error"
        );

        return false;
    }
}

// ============================================
// ADMIN LOGIN
// ============================================

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    hideMessage("loginMessage");

    const button = $("loginButton");

    button.disabled = true;
    button.textContent = "Signing in...";

    try {
        const email = $("email").value.trim();
        const password = $("password").value;

        if (!email || !password) {
            throw new Error("Enter your email address and password.");
        }

        showMessage("loginMessage", "Connecting to Supabase...");

        const { error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            throw error;
        }

        await verifyAdministrator();

    } catch (error) {
        showMessage(
            "loginMessage",
            "Sign-in failed: " + friendlyAuthError(error),
            "error"
        );

    } finally {
        button.disabled = false;
        button.textContent = "Sign In";
    }
});

// If the session ends elsewhere (sign out, expiry), return to the login screen.
// Kept synchronous on purpose: awaiting Supabase calls inside this callback can deadlock.
supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
        currentUser = null;
        setLoggedIn(false);
    }
});

// ============================================
// LOAD CATEGORIES
// ============================================

async function loadCategories(selectedId = "") {
    const select = $("categoryId");

    select.innerHTML =
        '<option value="">Choose a category</option>';

    const { data, error } = await supabase
        .from("categories")
        .select("id, name")
        .eq("is_active", true)
        .order("display_order");

    if (error) {
        showMessage(
            "dashboardMessage",
            "Could not load categories: " + error.message,
            "error"
        );

        return;
    }

    for (const category of data || []) {
        const option = document.createElement("option");

        option.value = category.id;
        option.textContent = category.name;

        select.appendChild(option);
    }

    select.value = selectedId;
}

// ============================================
// LOAD PRODUCTS
// ============================================

async function loadProducts() {
    productList.innerHTML =
        '<p class="empty">Loading products...</p>';

    const { data, error } = await supabase
        .from("products")
        .select("*, categories(name)")
        .order("created_at", { ascending: false });

    if (error) {
        productList.innerHTML = "";

        showMessage(
            "dashboardMessage",
            "Could not load products: " + error.message,
            "error"
        );

        return;
    }

    allProducts = data || [];

    renderProducts(allProducts);
}

// ============================================
// DISPLAY PRODUCTS
// ============================================

function renderProducts(products) {
    if (!products.length) {
        productList.innerHTML =
            '<p class="empty">No products yet. Add your first advertised product above.</p>';

        return;
    }

    productList.innerHTML = products.map((product) => {
        const id = escapeHTML(product.id);

        const image = product.image_url
            ? `<img src="${escapeHTML(product.image_url)}" alt="${escapeHTML(product.name)}" loading="lazy">`
            : "";

        const price =
            product.price !== null && product.price !== undefined
                ? `<p>${escapeHTML(product.currency || "KES")} ${Number(product.price).toLocaleString()}</p>`
                : "";

        const publicationClass = product.is_published
            ? "published"
            : "draft";

        const publicationText = product.is_published
            ? "Published"
            : "Draft";

        const featuredBadge = product.is_featured
            ? '<span class="badge">Featured</span>'
            : "";

        return `
            <article class="product-card">
                ${image}

                <div class="product-info">

                    <span class="badge ${publicationClass}">
                        ${publicationText}
                    </span>

                    ${featuredBadge}

                    <h3>${escapeHTML(product.name)}</h3>

                    <p>
                        ${escapeHTML(
                            product.categories?.name || "Uncategorised"
                        )}
                    </p>

                    ${price}

                    <p>${escapeHTML(product.description || "")}</p>

                    <div class="card-actions">

                        <button
                            type="button"
                            class="btn btn-secondary"
                            data-edit="${id}">
                            Edit
                        </button>

                        <button
                            type="button"
                            class="btn btn-gold"
                            data-toggle="${id}">
                            ${product.is_published ? "Unpublish" : "Publish"}
                        </button>

                        <button
                            type="button"
                            class="btn btn-danger"
                            data-delete="${id}">
                            Delete
                        </button>

                    </div>
                </div>
            </article>
        `;
    }).join("");
}

// ============================================
// RESET PRODUCT FORM
// ============================================

function resetForm() {
    productForm.reset();

    $("productId").value = "";
    $("formTitle").textContent = "Add a Product";
    $("saveButton").textContent = "Save Product";

    $("cancelEditButton").classList.add("hidden");

    existingImageUrl = "";
}

$("cancelEditButton").addEventListener("click", resetForm);

// ============================================
// ADD OR UPDATE PRODUCT
// ============================================

productForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    hideMessage("dashboardMessage");

    if (!currentUser) {
        showMessage(
            "dashboardMessage",
            "Please sign in again before saving a product.",
            "error"
        );

        return;
    }

    const saveButton = $("saveButton");

    saveButton.disabled = true;
    saveButton.textContent = "Saving...";

    let uploadedPath = null;

    try {
        const name = $("productName").value.trim();
        const description = $("description").value.trim();

        if (!name) {
            throw new Error("Enter the product name.");
        }

        if (!description) {
            throw new Error("Enter a product description.");
        }

        const productUrl = safeExternalUrl(
            $("productUrl").value.trim()
        );

        if (!productUrl) {
            throw new Error(
                "Enter a valid product URL beginning with https://"
            );
        }

        const priceText = $("price").value.trim();

        const price = priceText === ""
            ? null
            : Number(priceText);

        if (price !== null && (!Number.isFinite(price) || price < 0)) {
            throw new Error("Enter a valid non-negative price.");
        }

        if (!$("categoryId").value) {
            throw new Error("Choose a product category.");
        }

        const productId = $("productId").value;

        const previousImageUrl = existingImageUrl;
        let imageUrl = existingImageUrl;

        const imageFile = $("productImage").files[0];

        if (imageFile) {
            const allowedTypes = [
                "image/jpeg",
                "image/png",
                "image/webp"
            ];

            if (!allowedTypes.includes(imageFile.type)) {
                throw new Error("Use a JPEG, PNG or WebP image.");
            }

            if (imageFile.size > 5 * 1024 * 1024) {
                throw new Error("The image must be 5 MB or smaller.");
            }

            const extensions = {
                "image/jpeg": "jpg",
                "image/png": "png",
                "image/webp": "webp"
            };

            uploadedPath =
                `${currentUser.id}/${crypto.randomUUID()}.${extensions[imageFile.type]}`;

            const { error: uploadError } = await supabase.storage
                .from("product-images")
                .upload(uploadedPath, imageFile, {
                    contentType: imageFile.type,
                    upsert: false
                });

            if (uploadError) {
                throw uploadError;
            }

            const { data: publicUrlData } = supabase.storage
                .from("product-images")
                .getPublicUrl(uploadedPath);

            imageUrl = publicUrlData.publicUrl;
        }

        const product = {
            category_id: $("categoryId").value,
            name: name,
            description: description,
            price: price,
            currency: $("currency").value,
            image_url: imageUrl || null,
            marketplace_name:
                $("marketplaceName").value.trim() || null,
            product_url: productUrl,
            is_featured: $("isFeatured").checked,
            is_published: $("isPublished").checked
        };

        if (!productId) {
            product.slug =
                `${makeSlug(name)}-${crypto.randomUUID().slice(0, 8)}`;

            const { error } = await supabase
                .from("products")
                .insert(product);

            if (error) {
                throw error;
            }
        } else {
            const { error } = await supabase
                .from("products")
                .update(product)
                .eq("id", productId);

            if (error) {
                throw error;
            }
        }

        // The database save worked, so the new upload must now be kept.
        const newUploadWasKept = Boolean(uploadedPath);
        uploadedPath = null;

        // A replaced image is no longer used by anything, so remove it.
        if (newUploadWasKept && previousImageUrl) {
            await removeStoredImage(previousImageUrl);
        }

        resetForm();

        showMessage(
            "dashboardMessage",
            "Product saved successfully.",
            "success"
        );

        await loadProducts();

    } catch (error) {
        // The save failed, so do not leave an orphaned upload behind.
        if (uploadedPath) {
            await supabase.storage
                .from("product-images")
                .remove([uploadedPath]);
        }

        showMessage(
            "dashboardMessage",
            "Could not save product: " +
                (error.message || "Unknown error."),
            "error"
        );

    } finally {
        saveButton.disabled = false;

        saveButton.textContent = $("productId").value
            ? "Update Product"
            : "Save Product";
    }
});

// ============================================
// EDIT, PUBLISH, UNPUBLISH AND DELETE
// ============================================

productList.addEventListener("click", async (event) => {
    const button = event.target.closest("button");

    if (!button) return;

    const editId = button.dataset.edit;
    const toggleId = button.dataset.toggle;
    const deleteId = button.dataset.delete;

    // IDs come from data-* attributes, which are always strings, so compare
    // as strings. This also works if the table uses numeric IDs.
    const findProduct = (id) =>
        allProducts.find((item) => String(item.id) === String(id));

    try {
        if (editId) {
            const product = findProduct(editId);

            if (!product) return;

            $("productId").value = product.id;
            $("productName").value = product.name;
            $("categoryId").value = product.category_id || "";
            $("description").value = product.description || "";
            $("price").value = product.price ?? "";
            $("currency").value = product.currency || "KES";
            $("marketplaceName").value =
                product.marketplace_name || "";
            $("productUrl").value = product.product_url;

            $("isFeatured").checked = Boolean(product.is_featured);
            $("isPublished").checked = Boolean(product.is_published);

            existingImageUrl = product.image_url || "";

            $("formTitle").textContent = "Edit Product";
            $("saveButton").textContent = "Update Product";

            $("cancelEditButton").classList.remove("hidden");

            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });

            return;
        }

        if (toggleId) {
            const product = findProduct(toggleId);

            if (!product) return;

            const { error } = await supabase
                .from("products")
                .update({
                    is_published: !product.is_published
                })
                .eq("id", product.id);

            if (error) {
                throw error;
            }

            showMessage(
                "dashboardMessage",
                "Publication status updated.",
                "success"
            );

            await loadProducts();

            return;
        }

        if (deleteId) {
            const product = findProduct(deleteId);

            if (!product) return;

            const confirmed = confirm(
                `Delete "${product.name}" permanently?`
            );

            if (!confirmed) return;

            const { error } = await supabase
                .from("products")
                .delete()
                .eq("id", product.id);

            if (error) {
                throw error;
            }

            // Remove the product's image too, so storage does not fill up.
            await removeStoredImage(product.image_url);

            showMessage(
                "dashboardMessage",
                "Product deleted successfully.",
                "success"
            );

            await loadProducts();
        }

    } catch (error) {
        showMessage(
            "dashboardMessage",
            error.message || "The requested operation failed.",
            "error"
        );
    }
});

// ============================================
// SEARCH PRODUCTS
// ============================================

$("searchProducts").addEventListener("input", (event) => {
    const query = event.target.value.toLowerCase().trim();

    const filteredProducts = allProducts.filter((product) =>
        (product.name || "").toLowerCase().includes(query) ||
        (product.description || "").toLowerCase().includes(query) ||
        (product.marketplace_name || "").toLowerCase().includes(query)
    );

    renderProducts(filteredProducts);
});

// ============================================
// REFRESH PRODUCTS
// ============================================

$("refreshButton").addEventListener("click", async () => {
    hideMessage("dashboardMessage");

    await loadCategories($("categoryId").value);
    await loadProducts();
});

// ============================================
// LOGOUT
// ============================================

$("logoutButton").addEventListener("click", async () => {
    try {
        const { error } = await supabase.auth.signOut();

        if (error) {
            throw error;
        }

        currentUser = null;

        setLoggedIn(false);
        resetForm();

        showMessage(
            "loginMessage",
            "You have signed out.",
            "success"
        );

    } catch (error) {
        showMessage(
            "dashboardMessage",
            error.message || "Could not sign out.",
            "error"
        );
    }
});

// ============================================
// RESTORE EXISTING SESSION
// ============================================

async function initializeDashboard() {
    try {
        const {
            data: { session },
            error
        } = await supabase.auth.getSession();

        if (error) {
            throw error;
        }

        if (session) {
            await verifyAdministrator();
        } else {
            setLoggedIn(false);
        }

    } catch (error) {
        setLoggedIn(false);

        showMessage(
            "loginMessage",
            "Initialization failed: " +
                (error.message || "Could not connect to Supabase."),
            "error"
        );
    }
}

initializeDashboard();