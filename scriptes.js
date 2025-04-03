// Transport Cost Calculation System - Complete code
'use strict';

// ======================
// GLOBAL VARIABLES
// ======================
let map;
let markers = [];
let routingControl1, routingControl2;
let currentMargin = 0;
let savedCalculations = [];
let calculationId = 0;
const FERRY_TERMINALS = {};

// Price configuration
const CONFIG = {
  collectionPricePerKm: 2,
  collectionPricePerKmCork: 2.5,
  collectionMinPrice: 450,
  deliveryPricePerKm: 3,
  deliveryMinPrice: 300,
  ferryCost: 0
};

// Selection state
const selectionState = {
  mode: 'map',
  step: 1,
  collectionStart: null,
  ferryRoute: null,
  deliveryEnd: null
};


//Api List ferry 
// URL de votre API SharePoint
const apiUrl = "https://hendrickeuropean.sharepoint.com/sites/TestDeveloptment/_api/web/lists/getbytitle('Ferry%20Overview1')/items";

// Fonction pour récupérer et afficher les données
async function loadFerries() {
  try {
    const response = await fetch(apiUrl, {
      headers: {
        "Accept": "application/json;odata=verbose"
      }
    });
    
    if (!response.ok) throw new Error("Erreur réseau");

    const data = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(data, "application/xml");
    
    // Extraire les entrées
    const entries = xmlDoc.getElementsByTagName("entry");
    const select = document.getElementById("ferry-select");
    const tableBody = document.querySelector("#ferry-table tbody");

    for (let entry of entries) {
      const properties = entry.getElementsByTagName("m:properties")[0];
      
      // Extraire les valeurs
      const title = properties.getElementsByTagName("d:Title")[0]?.textContent || "N/A";
      const price = properties.getElementsByTagName("d:Price")[0]?.getAttribute("m:type") === "Edm.Double" 
        ? properties.getElementsByTagName("d:Price")[0].textContent 
        : "0";
      const from = JSON.parse(properties.getElementsByTagName("d:From")[0]?.textContent || '{}').DisplayName || "N/A";
      const to = JSON.parse(properties.getElementsByTagName("d:To")[0]?.textContent || '{}').DisplayName || "N/A";
      const lat = properties.getElementsByTagName("d:LatitudeFrom")[0]?.textContent || "0";
      const lon = properties.getElementsByTagName("d:LongitudeFrom")[0]?.textContent || "0";
      const pricePerKm = properties.getElementsByTagName("d:Priceperkm")[0]?.textContent || "0";
      const minimum = properties.getElementsByTagName("d:Minimum")[0]?.textContent || "0";

      // Ajouter une option au select
      const option = document.createElement("option");
      option.value = `${price}.${from}.${to}.${pricePerKm}.${minimum}`;
      option.textContent = `${title}: ${from} → ${to} (${price}€)`;
      select.appendChild(option);

      // Ajouter une ligne au tableau
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${from}</td>
        <td>${to}</td>
        <td>${price}€</td>
        <td>${lat}</td>
        <td>${lon}</td>
      `;
      tableBody.appendChild(row);
    }

  } catch (error) {
    console.error("Erreur:", error);
    alert("Impossible de charger les données des ferries");
  }
}

// Charger les données au démarrage
document.addEventListener("DOMContentLoaded", loadFerries);


// ======================
// INITIALIZATION
// ======================

/**
 * Initializes the transport system
 */
function initializeTransportSystem() {
  try {
    // Check if map container exists
    const mapElement = document.getElementById('map');
    if (!mapElement) throw new Error("Element #map not found");
    
    // Initialize Leaflet map
    initMap();
    
    // Initialize ferry terminals
    initializeFerryTerminals();
    
    // Configure controls and listeners
    setupControls();
    setupEventListeners();
    
    // Update UI
    updateStepUI();
    
    console.log("System initialized successfully");
  } catch (error) {
    console.error("Initialization error:", error);
    showMapError("System initialization error");
  }
}

/**
 * Initializes Leaflet map
 */
function initMap() {
  map = L.map('map', {
    center: [46.603354, 1.888334], // Center on France
    zoom: 6,
    preferCanvas: true,
    zoomControl: true
  });

  // Add OpenStreetMap layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    detectRetina: true
  }).addTo(map);
}

/**
 * Initializes ferry terminals from HTML table
 */
function initializeFerryTerminals() {
  try {
    const rows = document.querySelectorAll("table tbody tr");
    
    rows.forEach(row => {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 3) {
        const terminalName = cells[0].textContent.trim();
        const lat = parseFloat(cells[1].textContent.trim().replace(',', '.'));
        const lng = parseFloat(cells[2].textContent.trim().replace(',', '.'));
        
        if (!isNaN(lat) && !isNaN(lng)) {
          FERRY_TERMINALS[terminalName] = { lat, lng };
        }
      }
    });
  } catch (error) {
    console.error("Error loading ferry terminals:", error);
  }
}

// ======================
// MAIN FUNCTIONS
// ======================

/**
 * Configures map controls
 */
function setupControls() {
  // Scale control
  L.control.scale({ imperial: false, metric: true }).addTo(map);
}

/**
 * Configures event listeners
 */
function setupEventListeners() {
  // Margin slider
  document.getElementById('margin-slider').addEventListener('input', function() {
    currentMargin = parseInt(this.value);
    updateMarginDisplay();
    calculateTotal();
  });

  // Ferry selection
  document.getElementById('ferry-select').addEventListener('change', updateFerrySelection);

  // Mode buttons
  document.getElementById('address-mode-btn').addEventListener('click', () => setSelectionMode('address'));
  document.getElementById('map-mode-btn').addEventListener('click', () => setSelectionMode('map'));

  // Map click
  map.on('click', handleMapClick);
}

/**
 * Handles map click
 */
async function handleMapClick(e) {
  if (selectionState.mode !== 'map') return;

  const { lat, lng } = e.latlng;

  try {
    // Show temporary marker
    const tempMarker = createMarker([lat, lng], 'temp');
    tempMarker.bindPopup("<b>Loading...</b>").openPopup();

    // Get address name
    const name = await getAddressName(lat, lng);
    map.removeLayer(tempMarker);

    // Handle based on step
    if (selectionState.step === 1) {
      handleCollectionSelection(lat, lng, name);
    } else if (selectionState.step === 3) {
      handleDeliverySelection(lat, lng, name);
    }
  } catch (error) {
    console.error("Map click error:", error);
    showMapError("Selection error");
  }
}

/**
 * Handles collection point selection
 */
function handleCollectionSelection(lat, lng, name) {
  selectionState.collectionStart = { lat, lng, name };
  updateCurrentSelection();
  addPoint(lat, lng, name, 'collection');
  selectionState.step = 2;
  updateStepUI();
  document.getElementById('ferry-select').disabled = false;
}

/**
 * Handles delivery point selection
 */
function handleDeliverySelection(lat, lng, name) {
  if (!selectionState.ferryRoute) {
    showMapError("Please select ferry first");
    return;
  }

  selectionState.deliveryEnd = { lat, lng, name };
  updateCurrentSelection();
  addPoint(lat, lng, name, 'delivery');
  calculateAllRoutes();
  selectionState.step = 4;
  updateStepUI();
}

// ======================
// UI FUNCTIONS
// ======================

/**
 * Updates step UI
 */
function updateStepUI() {
  document.querySelectorAll('.step').forEach(step => {
    step.classList.remove('active', 'completed', 'disabled');
  });

  for (let i = 1; i < selectionState.step; i++) {
    const stepElement = document.getElementById(`step${i}`);
    if (stepElement) stepElement.classList.add('completed');
  }

  const currentStep = document.getElementById(`step${selectionState.step}`);
  if (currentStep) currentStep.classList.add('active');

  for (let i = selectionState.step + 1; i <= 3; i++) {
    const stepElement = document.getElementById(`step${i}`);
    if (stepElement) stepElement.classList.add('disabled');
  }
}

/**
 * Updates margin display
 */
function updateMarginDisplay() {
  document.getElementById('margin-value').textContent = `${currentMargin}%`;
  document.getElementById('margin-amount').textContent = `${Math.abs(currentMargin)}%`;
  
  const marginType = document.getElementById('margin-type');
  marginType.textContent = currentMargin > 0 ? "Discount" : currentMargin < 0 ? "Margin" : "None";
}

/**
 * Updates current selection display
 */
function updateCurrentSelection() {
  document.getElementById('current-collection').textContent =
    selectionState.collectionStart?.name || 'Not selected';

  document.getElementById('current-ferry').textContent =
    selectionState.ferryRoute 
      ? `${selectionState.ferryRoute.departure} → ${selectionState.ferryRoute.arrival} (${selectionState.ferryRoute.price}€)`
      : 'Not selected';

  document.getElementById('current-delivery').textContent =
    selectionState.deliveryEnd?.name || 'Not selected';
}

// ======================
// MAP FUNCTIONS
// ======================

/**
 * Creates a map marker
 */
function createMarker(latlng, type) {
  const icons = {
    collection: 'blue',
    delivery: 'red',
    ferryDeparture: 'green',
    ferryArrival: 'orange',
    temp: 'gold'
  };

  const iconUrl = `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${icons[type]}.png`;

  const marker = L.marker(latlng, {
    icon: L.icon({
      iconUrl: iconUrl,
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41]
    })
  }).addTo(map);

  markers.push(marker);
  return marker;
}

/**
 * Adds a point to the map
 */
function addPoint(lat, lng, name, type) {
  // Remove old markers of same type
  markers.forEach(marker => {
    const iconUrl = marker.options?.icon?.options?.iconUrl || '';
    if ((type === 'collection' && iconUrl.includes('blue')) || 
        (type === 'delivery' && iconUrl.includes('red'))) {
      map.removeLayer(marker);
    }
  });

  // Create new marker
  const marker = createMarker([lat, lng], type);
  marker.bindPopup(`<b>${name}</b>`);
}

/**
 * Adds ferry terminals to the map
 */
function addFerryTerminals(departure, arrival) {
  // Remove old ferry markers
  markers.forEach(marker => {
    const iconUrl = marker.options?.icon?.options?.iconUrl || '';
    if (iconUrl.includes('green') || iconUrl.includes('orange')) {
      map.removeLayer(marker);
    }
  });

  // Add departure terminal
  if (FERRY_TERMINALS[departure]) {
    const marker = createMarker(
      [FERRY_TERMINALS[departure].lat, FERRY_TERMINALS[departure].lng], 
      'ferryDeparture'
    );
    marker.bindPopup(`<b>Ferry departure: ${departure}</b>`);
  }

  // Add arrival terminal
  if (FERRY_TERMINALS[arrival]) {
    const marker = createMarker(
      [FERRY_TERMINALS[arrival].lat, FERRY_TERMINALS[arrival].lng], 
      'ferryArrival'
    );
    marker.bindPopup(`<b>Ferry arrival: ${arrival}</b>`);
  }
}

// ======================
// ROUTE CALCULATION
// ======================

/**
 * Calculates both routes (collection and delivery)
 */
function calculateAllRoutes() {
  if (!selectionState.collectionStart || !selectionState.ferryRoute || !selectionState.deliveryEnd) {
    console.error("Missing parameters");
    return;
  }

  try {
    // Remove old routes
    if (routingControl1) map.removeControl(routingControl1);
    if (routingControl2) map.removeControl(routingControl2);

    const { departure, arrival } = selectionState.ferryRoute;
    const departureTerminal = FERRY_TERMINALS[departure];
    const arrivalTerminal = FERRY_TERMINALS[arrival];

    if (!departureTerminal || !arrivalTerminal) {
      throw new Error("Terminal coordinates not found");
    }

    // Collection route
    routingControl1 = createRouteControl(
      [selectionState.collectionStart.lat, selectionState.collectionStart.lng],
      [departureTerminal.lat, departureTerminal.lng],
      '#3498db'
    );

    // Delivery route
    routingControl2 = createRouteControl(
      [arrivalTerminal.lat, arrivalTerminal.lng],
      [selectionState.deliveryEnd.lat, selectionState.deliveryEnd.lng],
      '#e74c3c'
    );

    // Events for collection route
    routingControl1.on('routesfound', e => {
      const distance = (e.routes[0].summary.totalDistance / 1000).toFixed(1);
      updateRouteDisplay(distance, null);
    });

    routingControl1.on('routingerror', e => {
      console.error("Route error:", e.error);
      showMapError("Cannot calculate collection route");
    });

    // Events for delivery route
    routingControl2.on('routesfound', e => {
      const distance = (e.routes[0].summary.totalDistance / 1000).toFixed(1);
      updateRouteDisplay(null, distance);
    });

    routingControl2.on('routingerror', e => {
      console.error("Route error:", e.error);
      showMapError("Cannot calculate delivery route");
    });

  } catch (error) {
    console.error("Route calculation error:", error);
    showMapError("Route calculation error");
  }
}

/**
 * Creates a route control
 */
function createRouteControl(start, end, color) {
  return L.Routing.control({
    waypoints: [
      L.latLng(start[0], start[1]),
      L.latLng(end[0], end[1])
    ],
    routeWhileDragging: false,
    show: false,
    lineOptions: { 
      styles: [{ color, opacity: 0.7, weight: 5 }] 
    },
    addWaypoints: false,
    draggableWaypoints: false
  }).addTo(map);
}

// ======================
// GEOCODING
// ======================

/**
 * Gets address name from coordinates
 */
async function getAddressName(lat, lng) {
  let address = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

  try {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`);

    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

    const data = await response.json();
    if (data.display_name) {
      address = data.display_name;
    } else if (data.address) {
      const addr = data.address;
      address = [
        addr.road,
        addr.village,
        addr.town,
        addr.city,
        addr.county,
        addr.country
      ].filter(Boolean).join(', ');
    }
  } catch (error) {
    console.error("Geocoding error:", error);
    throw error;
  }

  return address;
}

/**
 * Searches for an address
 */
window.searchAddress = async function() {
  if (selectionState.mode !== 'address') {
    showMapError("Switch to address search mode");
    return;
  }

  const query = document.getElementById('search-input').value.trim();
  if (!query) {
    showMapError("Enter an address to search");
    return;
  }

  const resultsContainer = document.getElementById('search-results');
  resultsContainer.innerHTML = "<p>Searching...</p>";

  try {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&accept-language=en`);
    
    if (!response.ok) throw new Error("Network error");

    const data = await response.json();
    if (data.length === 0) {
      resultsContainer.innerHTML = "<p>No results found</p>";
      return;
    }

    resultsContainer.innerHTML = "";
    data.forEach((item, index) => {
      const resultElement = document.createElement('div');
      resultElement.className = "search-result";
      resultElement.innerHTML = `
        <p><strong>${index + 1}. ${item.display_name}</strong></p>
        <button onclick="selectSearchResult(${item.lat}, ${item.lon}, '${item.display_name.replace(/'/g, "\\'")}')"
          class="select-btn">
          Select
        </button>
      `;
      resultsContainer.appendChild(resultElement);
    });
  } catch (error) {
    console.error("Search error:", error);
    resultsContainer.innerHTML = `<p>Error: ${error.message}</p>`;
  }
};

/**
 * Selects a search result
 */
window.selectSearchResult = function(lat, lng, name) {
  try {
    if (selectionState.step === 1) {
      handleCollectionSelection(parseFloat(lat), parseFloat(lng), name);
    } else if (selectionState.step === 3) {
      handleDeliverySelection(parseFloat(lat), parseFloat(lng), name);
    }

    document.getElementById('search-results').innerHTML = '';
    document.getElementById('search-input').value = '';
    map.setView([lat, lng], 12);
  } catch (error) {
    console.error("Selection error:", error);
    showMapError("Selection error");
  }
};

// ======================
// FERRY MANAGEMENT
// ======================

/**
 * Updates ferry selection
 */
function updateFerrySelection() {
  const select = document.getElementById('ferry-select');
  const selectedOption = select.options[select.selectedIndex];
  
  if (selectedOption.value) {
    if (!selectionState.collectionStart) {
      showMapError("Please select collection point first");
      select.value = "";
      return;
    }

    const [price, departure, arrival, pricePerKm, minimum] = selectedOption.value.split('.');
    
    // Update configuration
    CONFIG.ferryCost = parseInt(price);
    CONFIG.collectionPricePerKm = parseFloat(pricePerKm);
    CONFIG.collectionMinPrice = parseFloat(minimum);
    CONFIG.deliveryPricePerKm = parseFloat(pricePerKm);
    CONFIG.deliveryMinPrice = parseFloat(minimum);

    // Update display
    updatePriceDisplays(pricePerKm, minimum);
    
    // Save selection
    selectionState.ferryRoute = { departure, arrival, price };
    addFerryTerminals(departure, arrival);
    updateCurrentSelection();
    document.getElementById('ferry-cost').textContent = `${price} €`;

    // Recalculate if delivery already selected
    if (selectionState.deliveryEnd) {
      calculateAllRoutes();
    }

    selectionState.step = 3;
    updateStepUI();
  }
}

/**
 * Updates price displays
 */
function updatePriceDisplays(pricePerKm, minimum) {
  // Collection section
  document.querySelector('#route1 .calculation').innerHTML = `
    <p>Distance: <span id="distance1">${document.getElementById('distance1').textContent}</span></p>
    <p>Collection price (<span id="price-per-km">€${pricePerKm}/km</span>): <span id="collection-price">0 €</span></p>
    <p>Minimum <span id="minimum-price">€${minimum}</span> → Final price: <span id="final-collection">0 €</span></p>
  `;

  // Delivery section
  document.querySelector('#route2 .calculation').innerHTML = `
    <p>Distance: <span id="distance2">${document.getElementById('distance2').textContent}</span></p>
    <p>Delivery price (<span id="delivery-price-per-km">€${pricePerKm}/km</span>): <span id="delivery-price">0 €</span></p>
    <p>Minimum <span id="delivery-minimum-price">€${minimum}</span> → Final price: <span id="final-delivery">0 €</span></p>
  `;
}

// ======================
// CALCULATIONS AND DISPLAY
// ======================

/**
 * Updates route display
 */
function updateRouteDisplay(collectionDistance, deliveryDistance) {
  if (collectionDistance !== null) {
    document.getElementById('from1').textContent = selectionState.collectionStart.name;
    document.getElementById('to1').textContent = `${selectionState.ferryRoute.departure} (Ferry)`;
    document.getElementById('distance1').textContent = `${collectionDistance} km`;

    const collectionPrice = collectionDistance * CONFIG.collectionPricePerKm;
    const finalCollection = Math.max(collectionPrice, CONFIG.collectionMinPrice);
    
    document.getElementById('collection-price').textContent = `${collectionPrice.toFixed(2)} €`;
    document.getElementById('final-collection').textContent = `${finalCollection.toFixed(2)} €`;
    document.getElementById('display-collection').textContent = `${finalCollection.toFixed(2)} €`;
  }

  if (deliveryDistance !== null) {
    document.getElementById('from2').textContent = `${selectionState.ferryRoute.arrival} (Ferry)`;
    document.getElementById('to2').textContent = selectionState.deliveryEnd.name;
    document.getElementById('distance2').textContent = `${deliveryDistance} km`;

    const deliveryPrice = deliveryDistance * CONFIG.deliveryPricePerKm;
    const finalDelivery = Math.max(deliveryPrice, CONFIG.deliveryMinPrice);
    
    document.getElementById('delivery-price').textContent = `${deliveryPrice.toFixed(2)} €`;
    document.getElementById('final-delivery').textContent = `${finalDelivery.toFixed(2)} €`;
    document.getElementById('display-delivery').textContent = `${finalDelivery.toFixed(2)} €`;
  }

  calculateTotal();
}

/**
 * Calculates total
 */
function calculateTotal() {
  const collection = parseFloat(document.getElementById('display-collection').textContent) || 0;
  const delivery = parseFloat(document.getElementById('display-delivery').textContent) || 0;
  const ferry = CONFIG.ferryCost || 0;
  const subtotal = collection + delivery + ferry;

  const marginAmount = (subtotal * Math.abs(currentMargin)) / 100;
  const total = currentMargin > 0 ? subtotal + marginAmount : subtotal - marginAmount;

  document.getElementById('display-margin').textContent = `${marginAmount.toFixed(2)} €`;
  document.getElementById('total-cost').textContent = `${total.toFixed(2)} €`;
  document.getElementById('display-ferry').textContent = `${ferry.toFixed(2)} €`;
}

// ======================
// CALCULATIONS MANAGEMENT
// ======================

/**
 * Adds a calculation to history
 */
window.addCalculation = function() {
  if (!selectionState.collectionStart || !selectionState.ferryRoute || !selectionState.deliveryEnd) {
    showMapError("Complete all steps");
    return;
  }

  const calculation = {
    id: calculationId++,
    collection: document.getElementById('display-collection').textContent,
    delivery: document.getElementById('display-delivery').textContent,
    ferry: document.getElementById('display-ferry').textContent,
    margin: document.getElementById('display-margin').textContent,
    total: document.getElementById('total-cost').textContent,
    date: new Date().toLocaleString()
  };

  savedCalculations.push(calculation);
  updateCalculationsList();
  resetMap();
  
  if (savedCalculations.length > 0) {
    document.querySelector('.show-total-btn').style.display = 'inline-block';
  }
};

/**
 * Shows/hides saved calculations
 */
window.showAllCalculations = function() {
  const savedCalculationsDiv = document.getElementById('saved-calculations');
  savedCalculationsDiv.style.display = savedCalculationsDiv.style.display === 'none' ? 'block' : 'none';
  calculateGrandTotal();
};

/**
 * Updates calculations list
 */
function updateCalculationsList() {
  const listDiv = document.getElementById('calculations-list');
  listDiv.innerHTML = '';

  savedCalculations.forEach(calc => {
    const calcDiv = document.createElement('div');
    calcDiv.className = 'calculation-item';
    calcDiv.innerHTML = `
      <button class="delete-calculation" onclick="deleteCalculation(${calc.id})">×</button>
      <ul>
        <li><strong>Date:</strong> ${calc.date}</li>
        <li><strong>From:</strong> ${selectionState.collectionStart?.name || 'Not specified'}</li>
        <li><strong>To:</strong> ${selectionState.deliveryEnd?.name || 'Not specified'}</li>
        <li>Collection: ${calc.collection}</li>
        <li>Delivery: ${calc.delivery}</li>
        <li>Ferry cost: ${calc.ferry}</li>
        <li>Margin/Discount: ${calc.margin}</li>
        <li class="total"><strong>Total: ${calc.total}</strong></li>
      </ul>
    `;
    listDiv.appendChild(calcDiv);
  });
}

/**
 * Deletes a calculation
 */
window.deleteCalculation = function(id) {
  savedCalculations = savedCalculations.filter(calc => calc.id !== id);
  updateCalculationsList();
  calculateGrandTotal();
  
  if (savedCalculations.length === 0) {
    document.getElementById('saved-calculations').style.display = 'none';
    document.querySelector('.show-total-btn').style.display = 'none';
  }
};

/**
 * Calculates grand total
 */
function calculateGrandTotal() {
  if (savedCalculations.length === 0) return;

  let totals = {
    collection: 0,
    delivery: 0,
    ferry: 0,
    margin: 0,
    grand: 0
  };

  savedCalculations.forEach(calc => {
    totals.collection += parseFloat(calc.collection.replace(' €', ''));
    totals.delivery += parseFloat(calc.delivery.replace(' €', ''));
    totals.ferry += parseFloat(calc.ferry.replace(' €', ''));
    totals.margin += parseFloat(calc.margin.replace(' €', ''));
    totals.grand += parseFloat(calc.total.replace(' €', ''));
  });

  document.getElementById('grand-total').innerHTML = `
    <h3>Grand Total</h3>
    <p>Total Collection: ${totals.collection.toFixed(2)} €</p>
    <p>Total Delivery: ${totals.delivery.toFixed(2)} €</p>
    <p>Total Ferry: ${totals.ferry.toFixed(2)} €</p>
    <p>Total Margin/Discount: ${totals.margin.toFixed(2)} €</p>
    <hr>
    <p><strong>Final Total: ${totals.grand.toFixed(2)} €</strong></p>
  `;
}

// ======================
// UTILITY FUNCTIONS
// ======================

/**
 * Resets the map
 */
window.resetMap = function() {
  // Hide saved calculations and show total button
  document.getElementById('saved-calculations').style.display = 'none';
  document.querySelector('.show-total-btn').style.display = 'none';
  
  // Show total box
  document.getElementById('total-box').style.display = 'block';
  
  // Remove markers and routes
  markers.forEach(marker => map.removeLayer(marker));
  markers = [];
  
  if (routingControl1) map.removeControl(routingControl1);
  if (routingControl2) map.removeControl(routingControl2);

  // Reset state
  selectionState.step = 1;
  selectionState.collectionStart = null;
  selectionState.ferryRoute = null;
  selectionState.deliveryEnd = null;
  CONFIG.ferryCost = 0;

  // Reset UI
  updateStepUI();
  updateCurrentSelection();
  
  // Reset displays
  const elementsToReset = [
    'distance1', 'distance2', 'collection-price', 'final-collection',
    'delivery-price', 'final-delivery', 'display-collection', 'display-delivery',
    'display-margin', 'total-cost', 'ferry-cost', 'from1', 'to1', 'from2', 'to2'
  ];
  
  elementsToReset.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = id.includes('distance') ? '0 km' : 
                          id.includes('display') ? '0 €' : 
                          id.includes('from') || id.includes('to') ? 'Not defined' : '0 €';
    }
  });

  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-input').value = '';
  document.getElementById('ferry-select').value = '';
  document.getElementById('ferry-select').disabled = true;

  // Reset margin slider
  document.getElementById('margin-slider').value = 0;
  currentMargin = 0;
  updateMarginDisplay();

  // Reset prices
  updatePriceDisplays(
    CONFIG.collectionPricePerKm.toString(), 
    CONFIG.collectionMinPrice.toString()
  );

  setSelectionMode('map');
  hideMapError();
};

/**
 * Sets selection mode
 */
window.setSelectionMode = function(mode) {
  selectionState.mode = mode;
  document.getElementById('map-mode-btn').classList.toggle('active', mode === 'map');
  document.getElementById('address-mode-btn').classList.toggle('active', mode === 'address');
};

/**
 * Shows map error
 */
function showMapError(message) {
  const errorElement = document.getElementById('map-error');
  if (errorElement) {
    errorElement.querySelector('p').textContent = message || "Unknown error";
    errorElement.style.display = 'block';
  }
}

/**
 * Hides map error
 */
window.hideMapError = function() {
  const errorElement = document.getElementById('map-error');
  if (errorElement) {
    errorElement.style.display = 'none';
  }
};

// ======================
// PDF GENERATION
// ======================

/**
 * Generates PDF with only saved calculations
 */
window.generatePDF = async function() {
  const loadingElement = document.getElementById('loading');
  if (loadingElement) loadingElement.style.display = 'flex';

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm'
    });

    // Header
    doc.setFontSize(20);
    doc.text('Transport Cost Calculations', 105, 15, { align: 'center' });

    // Date
    doc.setFontSize(12);
    doc.text(`Report generated: ${new Date().toLocaleString()}`, 15, 25);
    
    let yPosition = 35;

    // Saved calculations
    if (savedCalculations.length > 0) {
      doc.setFontSize(16);
      doc.text('Saved Calculations:', 15, yPosition);
      yPosition += 10;
      
      savedCalculations.forEach((calc, index) => {
        // New page if needed
        if (yPosition > 250) {
          doc.addPage();
          yPosition = 20;
        }
        
        doc.setFontSize(12);
        doc.text(`Calculation #${index + 1}`, 15, yPosition);
        yPosition += 7;
        
        doc.text(`Date: ${calc.date}`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`From: ${selectionState.collectionStart?.name || 'Not specified'}`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`To: ${selectionState.deliveryEnd?.name || 'Not specified'}`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`Collection: ${calc.collection}`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`Delivery: ${calc.delivery}`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`Ferry: ${calc.ferry}`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`Margin/Discount: ${calc.margin}`, 20, yPosition);
        yPosition += 7;
        
        doc.setFontSize(14);
        doc.text(`Total: ${calc.total}`, 20, yPosition);
        yPosition += 15;
        
        // Separator line
        doc.line(15, yPosition, 195, yPosition);
        yPosition += 10;
      });
      
      // Grand totals
      if (savedCalculations.length > 1) {
        doc.setFontSize(16);
        doc.text('Grand Totals:', 15, yPosition);
        yPosition += 10;
        
        const totals = {
          collection: savedCalculations.reduce((sum, calc) => sum + parseFloat(calc.collection.replace(' €', '')), 0),
          delivery: savedCalculations.reduce((sum, calc) => sum + parseFloat(calc.delivery.replace(' €', '')), 0),
          ferry: savedCalculations.reduce((sum, calc) => sum + parseFloat(calc.ferry.replace(' €', '')), 0),
          margin: savedCalculations.reduce((sum, calc) => sum + parseFloat(calc.margin.replace(' €', '')), 0),
          grand: savedCalculations.reduce((sum, calc) => sum + parseFloat(calc.total.replace(' €', '')), 0)
        };
        
        doc.setFontSize(12);
        doc.text(`Total Collection: ${totals.collection.toFixed(2)} €`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`Total Delivery: ${totals.delivery.toFixed(2)} €`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`Total Ferry: ${totals.ferry.toFixed(2)} €`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`Total Margin/Discount: ${totals.margin.toFixed(2)} €`, 20, yPosition);
        yPosition += 7;
        
        doc.setFontSize(14);
        doc.text(`Final Total: ${totals.grand.toFixed(2)} €`, 20, yPosition);
      }
    } else {
      doc.setFontSize(14);
      doc.text('No saved calculations to display', 15, yPosition);
    }

    doc.save('transport_calculations.pdf');
  } catch (error) {
    console.error("PDF generation error:", error);
    showMapError("PDF generation error");
  } finally {
    if (loadingElement) loadingElement.style.display = 'none';
  }
};

// ======================
// INITIALIZATION
// ======================

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', function() {
  // Check if Leaflet is loaded
  if (typeof L === 'undefined') {
    console.error("Leaflet not loaded!");
    showMapError("Library loading error");
    return;
  }

  // Initialize system
  setTimeout(() => {
    try {
      initializeTransportSystem();
      
      // Show saved calculations if any
      if (savedCalculations.length > 0) {
        document.querySelector('.show-total-btn').style.display = 'inline-block';
        document.getElementById('saved-calculations').style.display = 'block';
      }
    } catch (error) {
      console.error("Initialization error:", error);
    }
  }, 100);
});