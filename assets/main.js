let allItems = [];
let selectedItems = new Map();

const STORAGE_KEY = "grocery-list-items";

const CACHE_KEY = "tarkov-items-cache";
const CACHE_EXPIRY_KEY = "tarkov-items-cache-expiry";
const CACHE_DURATION = 30 * 60 * 1000;

const SORT_KEY = "grocery-list-sort";

const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  iconColor: "white",
  customClass: {
    popup: "colored-toast",
  },
  showConfirmButton: false,
  timer: 1500,
  timerProgressBar: true,
});

function saveToLocalStorage() {
  const itemsArray = Array.from(selectedItems.entries()).map(([id, count]) => ({
    id,
    count,
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(itemsArray));
}

function loadFromLocalStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return new Map();
  
  try {
    const parsed = JSON.parse(saved);
    
    if (Array.isArray(parsed) && (parsed.length === 0 || typeof parsed[0] === 'string')) {
      const newMap = new Map();
      parsed.forEach(id => newMap.set(id, 1));
      return newMap;
    }
    
    return new Map(parsed.map(item => [item.id, item.count]));
  } catch (e) {
    console.error('Corrupt data found in localStorage, clearing...', e);
    localStorage.removeItem(STORAGE_KEY);
    return new Map();
  }
}

async function getItems() {
  try {
    const cachedData = localStorage.getItem(CACHE_KEY);
    const cacheExpiry = localStorage.getItem(CACHE_EXPIRY_KEY);
    const now = Date.now();

    if (cachedData && cacheExpiry && now < parseInt(cacheExpiry)) {
      console.log("Using cached data");
      return JSON.parse(cachedData);
    }

    console.log("Fetching fresh data");
    const response = await fetch("https://api.tarkov.dev/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `query { 
                items(lang: en) { 
                  id 
                  name
                  width
                  height
                  sellFor {
                    price
                    currency
                    vendor {
                      name
                    }
                  }
                  buyFor {
                    price
                    currency
                    vendor {
                      name
                    }
                  }
                }
              }`,
      }),
    });

    const data = await response.json();

    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(CACHE_EXPIRY_KEY, (now + CACHE_DURATION).toString());

    return data;
  } catch (error) {
    console.error("Error in getItems:", error);
    throw error;
  }
}

function convertToRUB(price, currency) {
  switch (currency) {
    case "USD":
      return price * 125;
    case "EUR":
      return price * 135;
    default:
      return price;
  }
}

function getBestBuyPrice(buyForArray) {
  if (!buyForArray || buyForArray.length === 0) return null;

  let bestPrice = null;
  let lowestRUBValue = Infinity;

  buyForArray.forEach((price) => {
    const priceInRUB = convertToRUB(price.price, price.currency);
    if (priceInRUB < lowestRUBValue) {
      lowestRUBValue = priceInRUB;
      bestPrice = price;
    }
  });

  return bestPrice;
}

function getBestSellPrice(sellForArray) {
  if (!sellForArray || sellForArray.length === 0) return null;

  let bestPrice = null;
  let highestRUBValue = 0;

  sellForArray.forEach((price) => {
    const priceInRUB = convertToRUB(price.price, price.currency);
    if (priceInRUB > highestRUBValue) {
      highestRUBValue = priceInRUB;
      bestPrice = price;
    }
  });

  return bestPrice;
}

function formatPriceWithCurrency(price, currency) {
  const formattedPrice = price.toLocaleString();
  switch (currency) {
    case "RUB":
      return `₽${formattedPrice}`;
    case "USD":
      return `$${formattedPrice}`;
    case "EUR":
      return `€${formattedPrice}`;
    default:
      return `${formattedPrice} ${currency}`;
  }
}

function formatTraderPrices(item) {
  const bestBuy = getBestBuyPrice(item.buyFor);
  const bestSell = getBestSellPrice(item.sellFor);

  let priceText = [];

  if (bestBuy) {
    priceText.push(
      `<span class="text-red-400">Buy: ${formatPriceWithCurrency(
        bestBuy.price,
        bestBuy.currency
      )} (${bestBuy.vendor.name})</span>`
    );
  }

  if (bestSell) {
    priceText.push(
      `<span class="text-green-400">Sell: ${formatPriceWithCurrency(
        bestSell.price,
        bestSell.currency
      )} (${bestSell.vendor.name})</span>`
    );
  }

  return priceText.join(" - ") || "No price data";
}

function createSearchResults(searchTerm) {
  const results = allItems
    .filter((item) =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .slice(0, 10);

  const resultsDiv = document.getElementById("search-results");
  resultsDiv.innerHTML = "";
  resultsDiv.classList.remove("hidden");

  results.forEach((item) => {
    const isInList = selectedItems.has(item.id);
    const div = document.createElement("div");
    div.className = "p-1 hover:bg-gray-700 cursor-pointer";
    div.innerHTML = `
            <div class="flex items-center gap-2 text-gray-100">
              <img src="https://assets.tarkov.dev/${item.id}-icon.webp" class="w-8 h-8 object-contain" loading="lazy"
                onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><text x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22>📦</text></svg>'" />
              <div class="flex-grow">
                <div class="text-gray-100">
                  <span>${item.name}</span>
                  <span class="text-gray-400 text-xs">${item.width}x${item.height}</span>
                  ${isInList ? '<span class="text-xs text-purple-400">(in list)</span>' : ''}
                </div>
                <div class="text-gray-400 text-xs">${formatTraderPrices(item)}</div>
              </div>
            </div>
          `;
    div.onclick = () => {
      if (isInList) {
        updateItemCount(item.id, 1);
        document.getElementById("search").value = "";
        document.getElementById("search-results").classList.add("hidden");
        Toast.fire({
          icon: "success",
          title: "Added 1 more to list",
        });
      } else {
        addItem(item);
      }
    };
    resultsDiv.appendChild(div);
  });
}

function addItemToUI(item) {
  const selectedList = document.getElementById("selected-items");
  const div = document.createElement("div");
  const itemCount = selectedItems.get(item.id) || 1;
  
  div.className =
    "flex items-center gap-3 bg-gray-800 p-1 rounded-lg border border-gray-700";
  div.innerHTML = `
          <img src="https://assets.tarkov.dev/${item.id}-icon.webp" class="w-12 h-12 object-contain" loading="lazy"
            onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><text x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22>📦</text></svg>'" />
          <div class="flex-grow">
            <div class="text-gray-100">
              <span>${item.name}</span>
              <span class="text-gray-400 text-xs">${item.width}x${item.height}</span>
            </div>
            <div class="text-gray-400 text-sm">${formatTraderPrices(item)}</div>
          </div>
          <div class="flex items-center gap-2 mr-2">
            <button onclick="updateItemCount('${item.id}', -1)" class="text-gray-400 hover:text-gray-200 hover:scale-110 transition-all">➖</button>
            <span class="text-gray-200 min-w-[2ch] text-center select-none">${itemCount}</span>
            <button onclick="updateItemCount('${item.id}', 1)" class="text-gray-400 hover:text-gray-200 hover:scale-110 transition-all">➕</button>
          </div>
          <button onclick="removeItem('${item.id}')" class="text-red-400 hover:scale-110 transition-all mx-2">
            <span>🚫</span>
          </button>
        `;
  selectedList.appendChild(div);
  updateEmptyListView();
}

function updateItemCount(itemId, delta) {
  const currentCount = selectedItems.get(itemId) || 1;
  const newCount = Math.max(1, currentCount + delta);
  selectedItems.set(itemId, newCount);
  
  const selectedList = document.getElementById("selected-items");
  const items = selectedList.children;
  for (let item of items) {
    if (item.querySelector(`img`).src.includes(itemId)) {
      const countSpan = item.querySelector('.text-gray-200');
      countSpan.textContent = newCount;
      break;
    }
  }
  
  saveToLocalStorage();
  sortItems();
}

function updateEmptyListView() {
  const emptyList = document.getElementById('empty-list');
  const selectedList = document.getElementById('selected-items');
  
  if (selectedItems.size === 0) {
    emptyList.classList.remove('hidden');
    selectedList.classList.add('hidden');
  } else {
    emptyList.classList.add('hidden');
    selectedList.classList.remove('hidden');
  }
}

function addItem(item, saveToStorage = true) {
  if (selectedItems.has(item.id)) {
    updateItemCount(item.id, 1);
    return;
  }

  selectedItems.set(item.id, 1);
  if (saveToStorage) {
    saveToLocalStorage();
  }

  addItemToUI(item);
  sortItems();

  document.getElementById("search").value = "";
  document.getElementById("search-results").classList.add("hidden");

  Toast.fire({
    icon: "success",
    title: "Item added to list",
  });
}

function removeItem(itemId) {
  selectedItems.delete(itemId);
  saveToLocalStorage();
  const selectedList = document.getElementById("selected-items");
  const items = selectedList.children;
  for (let item of items) {
    if (item.querySelector(`img`).src.includes(itemId)) {
      item.remove();
      break;
    }
  }
  
  updateEmptyListView();

  Toast.fire({
    icon: "success",
    title: "Item removed from list",
  });
}

function clearCache() {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(CACHE_EXPIRY_KEY);
  window.location.reload();
}

function sortItems() {
  const sortSelect = document.getElementById("sort-select");
  const selectedList = document.getElementById("selected-items");
  const items = Array.from(selectedList.children);

  const getItemById = (id) => allItems.find((item) => item.id === id);

  items.sort((a, b) => {
    const itemAId = a.querySelector("img").src.split("/").pop().split("-")[0];
    const itemBId = b.querySelector("img").src.split("/").pop().split("-")[0];
    const itemA = getItemById(itemAId);
    const itemB = getItemById(itemBId);

    localStorage.setItem(SORT_KEY, sortSelect.value);

    switch (sortSelect.value) {
      case "name-asc":
        return itemA.name.localeCompare(itemB.name);
      case "name-desc":
        return itemB.name.localeCompare(itemA.name);
      case "buy-asc":
      case "buy-desc": {
        const priceA = getBestBuyPrice(itemA.buyFor)?.price || Infinity;
        const priceB = getBestBuyPrice(itemB.buyFor)?.price || Infinity;
        return sortSelect.value === "buy-asc"
          ? priceA - priceB
          : priceB - priceA;
      }
      case "sell-asc":
      case "sell-desc": {
        const priceA = getBestSellPrice(itemA.sellFor)?.price || 0;
        const priceB = getBestSellPrice(itemB.sellFor)?.price || 0;
        return sortSelect.value === "sell-asc"
          ? priceA - priceB
          : priceB - priceA;
      }
      default:
        return 0;
    }
  });

  selectedList.innerHTML = "";
  items.forEach((item) => selectedList.appendChild(item));
}

(async () => {
  try {
    const loadingDiv = document.getElementById("loading");
    const expiry = localStorage.getItem(CACHE_EXPIRY_KEY);
    const now = Date.now();

    if (expiry && now < parseInt(expiry)) {
      loadingDiv.innerHTML = `
              <div class="text-center">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                <div class="text-gray-400 text-sm">Loading cached data...</div>
              </div>
            `;
    } else {
      loadingDiv.innerHTML = `
              <div class="text-center">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                <div class="text-gray-400 text-sm">Fetching fresh data...</div>
              </div>
            `;
    }

    const response = await getItems();
    allItems = response.data.items;

    selectedItems = new Map();

    document.getElementById("loading").classList.add("hidden");
    document.getElementById("main-content").classList.remove("hidden");

    document.getElementById("search").addEventListener("input", (e) => {
      if (e.target.value.length > 0) {
        createSearchResults(e.target.value);
      } else {
        document.getElementById("search-results").classList.add("hidden");
      }
    });

    document.addEventListener("click", (e) => {
      if (
        !e.target.closest("#search") &&
        !e.target.closest("#search-results")
      ) {
        document.getElementById("search-results").classList.add("hidden");
      }
    });

    const savedItemIds = loadFromLocalStorage();
    document.getElementById("selected-items").innerHTML = "";

    savedItemIds.forEach((count, id) => {
      const item = allItems.find(item => item.id === id);
      if (item) {
        selectedItems.set(id, count);
        addItemToUI(item);
      }
    });

    updateEmptyListView();

    const sort = localStorage.getItem(SORT_KEY);

    if (sort) {
      document.getElementById("sort-select").value = sort;
      sortItems();
    }

    saveToLocalStorage();

    const h1 = document.querySelector("h1");
    const cacheStatus = document.createElement("div");
    cacheStatus.className = "text-sm text-gray-400 flex items-center gap-2";

    const nextUpdate = localStorage.getItem(CACHE_EXPIRY_KEY);
    let timeUntilUpdate = 0;

    if (nextUpdate) {
      const expiryTime = parseInt(nextUpdate);
      if (!isNaN(expiryTime)) {
        timeUntilUpdate = Math.max(
          0,
          Math.round((expiryTime - Date.now()) / 60000)
        );
      }
    }

    cacheStatus.innerHTML = `
            <span>Next update in ${timeUntilUpdate} minutes</span>
            <button 
              onclick="clearCache()" 
              class="bg-transparent hover:scale-110 transition-all">
              <span>🔃</span>
            </button>
          `;

    h1.parentNode.insertBefore(cacheStatus, h1.nextSibling);

    document
      .getElementById("sort-select")
      .addEventListener("change", sortItems);
  } catch (error) {
    console.error("Failed to load items:", error);
    document.getElementById("loading").innerHTML = `
            <div class="text-red-400 text-center">
              <p>Failed to load items.</p>
              <button onclick="clearCache()" class="mt-4 px-4 py-2 bg-red-500 text-gray-100 rounded hover:bg-red-600 transition-colors">
                Retry
              </button>
            </div>
          `;
  }
})();
