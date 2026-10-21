import { supabase } from "./supabase.js";

const $ = (id) => document.getElementById(id);

// ============================================
// HELPERS
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

// Only http(s) links are ever used for "Shop Now".
function safeExternalUrl(value) {
    try {
        const url = new URL(value);

        return url.protocol === "https:" || url.protocol === "http:"
            ? url.href
            : null;
    } catch {
        return null;
    }
}

function showGridMessage(grid, text, isError = false) {
    grid.innerHTML =
        `<p class="grid-message${isError ? " error" : ""}">${escapeHTML(text)}</p>`;
}

// Small line icons for the category tiles, chosen by category name.
const ICONS = {
    fashion: '<path d="M12 7a2 2 0 1 0-2-2"/><path d="M12 7v2l8.5 5.5a1.2 1.2 0 0 1-.7 2.5H4.2a1.2 1.2 0 0 1-.7-2.5L12 9"/>',
    jewellery: '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M10 3 8 9l4 12 4-12-2-6"/>',
    beauty: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
    home: '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    lifestyle: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'
};

function iconFor(name = "") {
    const text = name.toLowerCase();

    let key = "star";

    if (/fashion|cloth|wear|shoe/.test(text)) key = "fashion";
    else if (/jewel|watch|ring/.test(text)) key = "jewellery";
    else if (/beauty|makeup|cosmetic|skin/.test(text)) key = "beauty";
    else if (/home|decor|furnit/.test(text)) key = "home";
    else if (/life|bag|accessor/.test(text)) key = "lifestyle";

    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key]}</svg>`;
}

function productCard(product, index = 0) {
    const url = safeExternalUrl(product.product_url);

    const image = product.image_url
        ? `<img src="${escapeHTML(product.image_url)}" alt="${escapeHTML(product.name)}" loading="lazy">`
        : `<div class="placeholder" aria-hidden="true">${escapeHTML((product.name || "?").charAt(0).toUpperCase())}</div>`;

    const category = product.categories?.name
        ? `<span class="tag">${escapeHTML(product.categories.name)}</span>`
        : "";

    const price =
        product.price !== null && product.price !== undefined
            ? `<p class="price">${escapeHTML(product.currency || "KES")} ${Number(product.price).toLocaleString()}</p>`
            : "";

    const seller = product.marketplace_name
        ? `<span class="seller">Available on ${escapeHTML(product.marketplace_name)}</span>`
        : "";

    const action = url
        ? `<a class="btn" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer sponsored">Shop Now</a>`
        : "";

    // Staggered entrance, capped so long lists do not wait.
    const delay = Math.min(index, 8) * 60;

    return `
        <article class="product-card" style="animation-delay:${delay}ms">
            ${image}
            <div class="product-body">
                ${category}
                <h3>${escapeHTML(product.name)}</h3>
                <p class="desc">${escapeHTML(product.description || "")}</p>
                ${price}
                ${seller}
                ${action}
            </div>
        </article>
    `;
}

// ============================================
// DATA
// ============================================

async function fetchCategories() {
    const { data, error } = await supabase
        .from("categories")
        .select("id, name")
        .eq("is_active", true)
        .order("display_order");

    if (error) throw error;

    return data || [];
}

async function fetchProducts({ featuredOnly = false, limit = null } = {}) {
    let query = supabase
        .from("products")
        .select(
            "id, name, description, price, currency, image_url, marketplace_name, product_url, is_featured, category_id, categories(name)"
        )
        .eq("is_published", true)
        .order("created_at", { ascending: false });

    if (featuredOnly) {
        query = query.eq("is_featured", true);
    }

    if (limit) {
        query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data || [];
}

// ============================================
// HOME PAGE
// ============================================

async function initHome() {
    const featuredGrid = $("featuredGrid");
    const categoryTiles = $("categoryTiles");

    showGridMessage(featuredGrid, "Loading products...");

    try {
        const categories = await fetchCategories();

        if (categoryTiles) {
            categoryTiles.innerHTML = categories.length
                ? categories.map((category) => `
                    <a class="category-tile" href="products.html?category=${encodeURIComponent(category.id)}">
                        <span class="icon">${iconFor(category.name)}</span>
                        ${escapeHTML(category.name)}
                    </a>`
                ).join("")
                : '<p class="grid-message">Categories are coming soon.</p>';
        }

        // Show featured products; fall back to the newest ones if none are featured.
        let products = await fetchProducts({ featuredOnly: true, limit: 8 });

        if (!products.length) {
            products = await fetchProducts({ limit: 8 });
        }

        if (!products.length) {
            showGridMessage(
                featuredGrid,
                "New products are being added. Please check back soon."
            );
            return;
        }

        featuredGrid.innerHTML = products.map(productCard).join("");

    } catch (error) {
        console.error(error);

        if (categoryTiles && categoryTiles.querySelector(".grid-message")) {
            showGridMessage(categoryTiles, "Categories could not be loaded.", true);
        }

        showGridMessage(
            featuredGrid,
            "Products could not be loaded right now. Please try again later.",
            true
        );
    }
}

// ============================================
// PRODUCTS PAGE
// ============================================

async function initProducts() {
    const grid = $("productGrid");
    const searchInput = $("searchInput");
    const categoryFilter = $("categoryFilter");
    const resultCount = $("resultCount");

    let allProducts = [];

    showGridMessage(grid, "Loading products...");

    function applyFilters() {
        const query = searchInput.value.toLowerCase().trim();
        const categoryId = categoryFilter.value;

        const filtered = allProducts.filter((product) => {
            const matchesCategory =
                !categoryId || String(product.category_id) === categoryId;

            const matchesSearch =
                !query ||
                (product.name || "").toLowerCase().includes(query) ||
                (product.description || "").toLowerCase().includes(query) ||
                (product.marketplace_name || "").toLowerCase().includes(query);

            return matchesCategory && matchesSearch;
        });

        resultCount.textContent =
            filtered.length + (filtered.length === 1 ? " product" : " products");

        if (!filtered.length) {
            showGridMessage(grid, "No products match your search.");
            return;
        }

        grid.innerHTML = filtered.map(productCard).join("");
    }

    try {
        const [categories, products] = await Promise.all([
            fetchCategories(),
            fetchProducts()
        ]);

        allProducts = products;

        for (const category of categories) {
            const option = document.createElement("option");

            option.value = category.id;
            option.textContent = category.name;

            categoryFilter.appendChild(option);
        }

        // Support links such as products.html?category=<id> from the home page.
        const requested = new URLSearchParams(location.search).get("category");

        if (requested) {
            categoryFilter.value = requested;
        }

        applyFilters();

    } catch (error) {
        console.error(error);

        resultCount.textContent = "";

        showGridMessage(
            grid,
            "Products could not be loaded right now. Please try again later.",
            true
        );

        return;
    }

    searchInput.addEventListener("input", applyFilters);
    categoryFilter.addEventListener("change", applyFilters);
}

// ============================================
// START
// ============================================

if ($("featuredGrid")) {
    initHome();
}

if ($("productGrid")) {
    initProducts();
}