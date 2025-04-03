'use strict';

// ======================
// CONFIGURATION GLOBALE
// ======================
let map;
let markers = [];
let routingControl1, routingControl2;
let currentMargin = 0;
let savedCalculations = [];
let calculationId = 0;
const FERRY_TERMINALS = {};

// Configuration des prix par défaut
const CONFIG = {
  collectionPricePerKm: 2,
  collectionMinPrice: 450,
  deliveryPricePerKm: 3,
  deliveryMinPrice: 300,
  ferryCost: 0
};

// État de sélection
const selectionState = {
  mode: 'map', // 'map' ou 'address'
  step: 1, // 1=Collection, 2=Ferry, 3=Delivery
  collectionStart: null,
  ferryRoute: null,
  deliveryEnd: null
};

// ======================
// INITIALISATION
// ======================

/**
 * Initialise le système de transport
 */
function initializeTransportSystem() {
  try {
    // Vérifie si le conteneur de la carte existe
    if (!document.getElementById('map')) {
      throw new Error("Element #map non trouvé");
    }
    
    // Initialise la carte Leaflet
    initMap();
    
    // Configure les contrôles et écouteurs
    setupControls();
    setupEventListeners();
    
    // Met à jour l'UI
    updateStepUI();
    
    console.log("Système initialisé avec succès");
  } catch (error) {
    console.error("Erreur d'initialisation:", error);
    showMapError("Erreur d'initialisation du système");
  }
}

/**
 * Initialise la carte Leaflet
 */
function initMap() {
  map = L.map('map', {
    center: [46.603354, 1.888334], // Centre sur la France
    zoom: 6,
    preferCanvas: true,
    zoomControl: true
  });

  // Ajoute la couche OpenStreetMap
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    detectRetina: true
  }).addTo(map);
}

/**
 * Configure les contrôles de la carte
 */
function setupControls() {
  L.control.scale({ imperial: false, metric: true }).addTo(map);
}

/**
 * Configure les écouteurs d'événements
 */
function setupEventListeners() {
  // Curseur de marge
  document.getElementById('margin-slider').addEventListener('input', function() {
    currentMargin = parseInt(this.value);
    updateMarginDisplay();
    calculateTotal();
  });

  // Sélection du ferry
  document.getElementById('ferry-select').addEventListener('change', updateFerrySelection);

  // Boutons de mode
  document.getElementById('address-mode-btn').addEventListener('click', () => setSelectionMode('address'));
  document.getElementById('map-mode-btn').addEventListener('click', () => setSelectionMode('map'));

  // Clic sur la carte
  map.on('click', handleMapClick);
}

// ======================
// FONCTIONS PRINCIPALES
// ======================

/**
 * Charge les ferries depuis SharePoint
 */
async function loadFerriesFromSharePoint() {
  try {
    const listTitle = "NomDeVotreListe"; // À remplacer par le nom réel de votre liste
    const response = await fetch(`${_spPageContextInfo.webAbsoluteUrl}/_api/web/lists/getbytitle('${listTitle}')/items`, {
      headers: {
        'Accept': 'application/json;odata=nometadata',
        'Content-Type': 'application/json;odata=nometadata'
      },
      credentials: 'include'
    });

    if (!response.ok) throw new Error('Échec du chargement des ferries');

    const data = await response.json();
    const ferrySelect = document.getElementById('ferry-select');
    ferrySelect.innerHTML = '<option value="">-- Sélectionnez un ferry --</option>';

    data.value.forEach(item => {
      // Analyse les données spécifiques à votre structure
      const ferryData = parseFerryData(item);
      
      const option = document.createElement('option');
      option.value = `${ferryData.price}.${ferryData.departure}.${ferryData.arrival}.${ferryData.pricePerKm}.${ferryData.minPrice}`;
      option.textContent = `${ferryData.name}: ${ferryData.departure} → ${ferryData.arrival}`;
      ferrySelect.appendChild(option);

      // Stocke les coordonnées des terminaux
      FERRY_TERMINALS[ferryData.departure] = { 
        lat: ferryData.departureLat, 
        lng: ferryData.departureLng 
      };
      
      if (ferryData.arrivalLat && ferryData.arrivalLng) {
        FERRY_TERMINALS[ferryData.arrival] = { 
          lat: ferryData.arrivalLat, 
          lng: ferryData.arrivalLng 
        };
      }
    });
    
  } catch (error) {
    console.error('Erreur de chargement des ferries:', error);
    showMapError('Impossible de charger les données des ferries');
  }
}

/**
 * Analyse les données d'un ferry depuis l'item SharePoint
 */
function parseFerryData(item) {
  // Adaptez cette fonction selon la structure exacte de vos données
  // Exemple basé sur l'image fournie:
  
  // Pour un item comme "CLDN DUB-ZEL - Dude-Pint 13.344410307895 - 4.341030641889 - Interrupt Port Service 2000 € - In Port 100"
  const parts = item.Title.split(' - ');
  
  return {
    name: parts[0].trim(), // "CLDN DUB-ZEL"
    departure: parts[1].split(' ')[0], // "Dude-Pint"
    departureLat: parseFloat(parts[1].split(' ')[1]), // 13.344...
    departureLng: parseFloat(parts[2]), // 4.341...
    arrival: parts[0].split('-')[1], // "ZEL" (extrait du nom)
    service: parts[3], // "Interrupt Port Service"
    price: parseInt(parts[4].replace(' €', '')), // 2000
    portType: parts[5], // "In Port"
    pricePerKm: parseInt(parts[6]), // 100
    minPrice: parseInt(parts[4].replace(' €', '')) * 0.2 // 20% du prix
  };
}

/**
 * Gère le clic sur la carte
 */
async function handleMapClick(e) {
  if (selectionState.mode !== 'map') return;

  const { lat, lng } = e.latlng;

  try {
    // Affiche un marqueur temporaire
    const tempMarker = createMarker([lat, lng], 'temp');
    tempMarker.bindPopup("<b>Chargement...</b>").openPopup();

    // Récupère le nom de l'adresse
    const name = await getAddressName(lat, lng);
    map.removeLayer(tempMarker);

    // Gère en fonction de l'étape
    if (selectionState.step === 1) {
      handleCollectionSelection(lat, lng, name);
    } else if (selectionState.step === 3) {
      handleDeliverySelection(lat, lng, name);
    }
  } catch (error) {
    console.error("Erreur de clic sur la carte:", error);
    showMapError("Erreur de sélection");
  }
}

/**
 * Gère la sélection du point de collecte
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
 * Gère la sélection du point de livraison
 */
function handleDeliverySelection(lat, lng, name) {
  if (!selectionState.ferryRoute) {
    showMapError("Veuillez d'abord sélectionner un ferry");
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
// FONCTIONS D'INTERFACE
// ======================

/**
 * Met à jour l'affichage des étapes
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
 * Met à jour l'affichage de la marge
 */
function updateMarginDisplay() {
  document.getElementById('margin-value').textContent = `${currentMargin}%`;
  document.getElementById('margin-amount').textContent = `${Math.abs(currentMargin)}%`;
  
  const marginType = document.getElementById('margin-type');
  marginType.textContent = currentMargin > 0 ? "Remise" : currentMargin < 0 ? "Marge" : "Aucune";
}

/**
 * Met à jour l'affichage des sélections courantes
 */
function updateCurrentSelection() {
  document.getElementById('current-collection').textContent =
    selectionState.collectionStart?.name || 'Non sélectionné';

  document.getElementById('current-ferry').textContent =
    selectionState.ferryRoute 
      ? `${selectionState.ferryRoute.departure} → ${selectionState.ferryRoute.arrival} (${selectionState.ferryRoute.price}€)`
      : 'Non sélectionné';

  document.getElementById('current-delivery').textContent =
    selectionState.deliveryEnd?.name || 'Non sélectionné';
}

// ======================
// FONCTIONS DE LA CARTE
// ======================

/**
 * Crée un marqueur sur la carte
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
 * Ajoute un point à la carte
 */
function addPoint(lat, lng, name, type) {
  // Supprime les anciens marqueurs du même type
  markers.forEach(marker => {
    const iconUrl = marker.options?.icon?.options?.iconUrl || '';
    if ((type === 'collection' && iconUrl.includes('blue')) || 
        (type === 'delivery' && iconUrl.includes('red'))) {
      map.removeLayer(marker);
    }
  });

  // Crée un nouveau marqueur
  const marker = createMarker([lat, lng], type);
  marker.bindPopup(`<b>${name}</b>`);
}

/**
 * Ajoute les terminaux de ferry à la carte
 */
function addFerryTerminals(departure, arrival) {
  // Supprime les anciens marqueurs de ferry
  markers.forEach(marker => {
    const iconUrl = marker.options?.icon?.options?.iconUrl || '';
    if (iconUrl.includes('green') || iconUrl.includes('orange')) {
      map.removeLayer(marker);
    }
  });

  // Ajoute le terminal de départ
  if (FERRY_TERMINALS[departure]) {
    const marker = createMarker(
      [FERRY_TERMINALS[departure].lat, FERRY_TERMINALS[departure].lng], 
      'ferryDeparture'
    );
    marker.bindPopup(`<b>Départ ferry: ${departure}</b>`);
  }

  // Ajoute le terminal d'arrivée
  if (FERRY_TERMINALS[arrival]) {
    const marker = createMarker(
      [FERRY_TERMINALS[arrival].lat, FERRY_TERMINALS[arrival].lng], 
      'ferryArrival'
    );
    marker.bindPopup(`<b>Arrivée ferry: ${arrival}</b>`);
  }
}

// ======================
// CALCUL DES ITINÉRAIRES
// ======================

/**
 * Calcule les deux itinéraires (collecte et livraison)
 */
function calculateAllRoutes() {
  if (!selectionState.collectionStart || !selectionState.ferryRoute || !selectionState.deliveryEnd) {
    console.error("Paramètres manquants");
    return;
  }

  try {
    // Supprime les anciens itinéraires
    if (routingControl1) map.removeControl(routingControl1);
    if (routingControl2) map.removeControl(routingControl2);

    const { departure, arrival } = selectionState.ferryRoute;
    const departureTerminal = FERRY_TERMINALS[departure];
    const arrivalTerminal = FERRY_TERMINALS[arrival];

    if (!departureTerminal || !arrivalTerminal) {
      throw new Error("Coordonnées des terminaux non trouvées");
    }

    // Itinéraire de collecte
    routingControl1 = createRouteControl(
      [selectionState.collectionStart.lat, selectionState.collectionStart.lng],
      [departureTerminal.lat, departureTerminal.lng],
      '#3498db'
    );

    // Itinéraire de livraison
    routingControl2 = createRouteControl(
      [arrivalTerminal.lat, arrivalTerminal.lng],
      [selectionState.deliveryEnd.lat, selectionState.deliveryEnd.lng],
      '#e74c3c'
    );

    // Événements pour l'itinéraire de collecte
    routingControl1.on('routesfound', e => {
      const distance = (e.routes[0].summary.totalDistance / 1000).toFixed(1);
      updateRouteDisplay(distance, null);
    });

    routingControl1.on('routingerror', e => {
      console.error("Erreur d'itinéraire:", e.error);
      showMapError("Impossible de calculer l'itinéraire de collecte");
    });

    // Événements pour l'itinéraire de livraison
    routingControl2.on('routesfound', e => {
      const distance = (e.routes[0].summary.totalDistance / 1000).toFixed(1);
      updateRouteDisplay(null, distance);
    });

    routingControl2.on('routingerror', e => {
      console.error("Erreur d'itinéraire:", e.error);
      showMapError("Impossible de calculer l'itinéraire de livraison");
    });

  } catch (error) {
    console.error("Erreur de calcul d'itinéraire:", error);
    showMapError("Erreur de calcul d'itinéraire");
  }
}

/**
 * Crée un contrôle d'itinéraire
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
// GÉOCODAGE
// ======================

/**
 * Obtient le nom d'une adresse à partir de coordonnées
 */
async function getAddressName(lat, lng) {
  let address = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

  try {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=fr`);

    if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);

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
    console.error("Erreur de géocodage:", error);
    throw error;
  }

  return address;
}

/**
 * Recherche une adresse
 */
window.searchAddress = async function() {
  if (selectionState.mode !== 'address') {
    showMapError("Passez en mode recherche par adresse");
    return;
  }

  const query = document.getElementById('search-input').value.trim();
  if (!query) {
    showMapError("Entrez une adresse à rechercher");
    return;
  }

  const resultsContainer = document.getElementById('search-results');
  resultsContainer.innerHTML = "<p>Recherche en cours...</p>";

  try {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&accept-language=fr`);
    
    if (!response.ok) throw new Error("Erreur réseau");

    const data = await response.json();
    if (data.length === 0) {
      resultsContainer.innerHTML = "<p>Aucun résultat trouvé</p>";
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
          Sélectionner
        </button>
      `;
      resultsContainer.appendChild(resultElement);
    });
  } catch (error) {
    console.error("Erreur de recherche:", error);
    resultsContainer.innerHTML = `<p>Erreur: ${error.message}</p>`;
  }
};

/**
 * Sélectionne un résultat de recherche
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
    console.error("Erreur de sélection:", error);
    showMapError("Erreur de sélection");
  }
};

// ======================
// GESTION DES FERRIES
// ======================

/**
 * Met à jour la sélection du ferry
 */
function updateFerrySelection() {
  const select = document.getElementById('ferry-select');
  const selectedOption = select.options[select.selectedIndex];
  
  if (selectedOption.value) {
    if (!selectionState.collectionStart) {
      showMapError("Veuillez d'abord sélectionner un point de collecte");
      select.value = "";
      return;
    }

    const [price, departure, arrival, pricePerKm, minimum] = selectedOption.value.split('.');
    
    // Met à jour la configuration
    CONFIG.ferryCost = parseInt(price);
    CONFIG.collectionPricePerKm = parseFloat(pricePerKm);
    CONFIG.collectionMinPrice = parseFloat(minimum);
    CONFIG.deliveryPricePerKm = parseFloat(pricePerKm);
    CONFIG.deliveryMinPrice = parseFloat(minimum);

    // Met à jour l'affichage
    updatePriceDisplays(pricePerKm, minimum);
    
    // Enregistre la sélection
    selectionState.ferryRoute = { departure, arrival, price };
    addFerryTerminals(departure, arrival);
    updateCurrentSelection();
    document.getElementById('ferry-cost').textContent = `${price} €`;

    // Recalcule si la livraison est déjà sélectionnée
    if (selectionState.deliveryEnd) {
      calculateAllRoutes();
    }

    selectionState.step = 3;
    updateStepUI();
  }
}

/**
 * Met à jour l'affichage des prix
 */
function updatePriceDisplays(pricePerKm, minimum) {
  // Section collecte
  document.querySelector('#route1 .calculation').innerHTML = `
    <p>Distance: <span id="distance1">${document.getElementById('distance1').textContent}</span></p>
    <p>Prix collecte (<span id="price-per-km">€${pricePerKm}/km</span>): <span id="collection-price">0 €</span></p>
    <p>Minimum <span id="minimum-price">€${minimum}</span> → Prix final: <span id="final-collection">0 €</span></p>
  `;

  // Section livraison
  document.querySelector('#route2 .calculation').innerHTML = `
    <p>Distance: <span id="distance2">${document.getElementById('distance2').textContent}</span></p>
    <p>Prix livraison (<span id="delivery-price-per-km">€${pricePerKm}/km</span>): <span id="delivery-price">0 €</span></p>
    <p>Minimum <span id="delivery-minimum-price">€${minimum}</span> → Prix final: <span id="final-delivery">0 €</span></p>
  `;
}

// ======================
// CALCULS ET AFFICHAGE
// ======================

/**
 * Met à jour l'affichage de l'itinéraire
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
 * Calcule le total
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
// GESTION DES CALCULS
// ======================

/**
 * Sauvegarde un calcul dans SharePoint
 */
async function saveCalculationToSharePoint(calculation) {
  try {
    const listTitle = "CalculsTransport"; // À adapter
    const response = await fetch(`${_spPageContextInfo.webAbsoluteUrl}/_api/web/lists/getbytitle('${listTitle}')/items`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json;odata=nometadata',
        'Content-Type': 'application/json;odata=nometadata',
        'X-RequestDigest': document.getElementById('__REQUESTDIGEST').value
      },
      body: JSON.stringify({
        __metadata: { type: `SP.Data.${listTitle}ListItem` },
        Title: `Calcul ${new Date().toLocaleString()}`,
        PointCollecte: selectionState.collectionStart?.name || '',
        PointLivraison: selectionState.deliveryEnd?.name || '',
        FerryUtilise: selectionState.ferryRoute ? 
          `${selectionState.ferryRoute.departure} → ${selectionState.ferryRoute.arrival}` : '',
        CoutCollecte: parseFloat(calculation.collection.replace(' €', '')),
        CoutLivraison: parseFloat(calculation.delivery.replace(' €', '')),
        CoutFerry: parseFloat(calculation.ferry.replace(' €', '')),
        MargeRemise: parseFloat(calculation.margin.replace(' €', '')),
        Total: parseFloat(calculation.total.replace(' €', '')),
        DateCalcul: new Date().toISOString()
      }),
      credentials: 'include'
    });

    if (!response.ok) throw new Error('Échec de la sauvegarde');

    return await response.json();
  } catch (error) {
    console.error('Erreur de sauvegarde:', error);
    throw error;
  }
}

/**
 * Ajoute un calcul à l'historique
 */
window.addCalculation = async function() {
  if (!selectionState.collectionStart || !selectionState.ferryRoute || !selectionState.deliveryEnd) {
    showMapError("Complétez toutes les étapes");
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

  try {
    await saveCalculationToSharePoint(calculation);
    savedCalculations.push(calculation);
    updateCalculationsList();
    resetMap();
    
    if (savedCalculations.length > 0) {
      document.querySelector('.show-total-btn').style.display = 'inline-block';
    }
  } catch (error) {
    showMapError("Échec de la sauvegarde du calcul");
  }
};

/**
 * Affiche/masque les calculs sauvegardés
 */
window.showAllCalculations = function() {
  const savedCalculationsDiv = document.getElementById('saved-calculations');
  savedCalculationsDiv.style.display = savedCalculationsDiv.style.display === 'none' ? 'block' : 'none';
  calculateGrandTotal();
};

/**
 * Met à jour la liste des calculs
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
        <li><strong>De:</strong> ${selectionState.collectionStart?.name || 'Non spécifié'}</li>
        <li><strong>À:</strong> ${selectionState.deliveryEnd?.name || 'Non spécifié'}</li>
        <li>Collecte: ${calc.collection}</li>
        <li>Livraison: ${calc.delivery}</li>
        <li>Ferry: ${calc.ferry}</li>
        <li>Marge/Remise: ${calc.margin}</li>
        <li class="total"><strong>Total: ${calc.total}</strong></li>
      </ul>
    `;
    listDiv.appendChild(calcDiv);
  });
}

/**
 * Supprime un calcul
 */
window.deleteCalculation = async function(id) {
  try {
    // Supprime de SharePoint si nécessaire
    const calcToDelete = savedCalculations.find(c => c.id === id);
    if (calcToDelete && calcToDelete.sharepointId) {
      await deleteCalculationFromSharePoint(calcToDelete.sharepointId);
    }
    
    // Supprime localement
    savedCalculations = savedCalculations.filter(calc => calc.id !== id);
    updateCalculationsList();
    calculateGrandTotal();
    
    if (savedCalculations.length === 0) {
      document.getElementById('saved-calculations').style.display = 'none';
      document.querySelector('.show-total-btn').style.display = 'none';
    }
  } catch (error) {
    console.error("Erreur de suppression:", error);
    showMapError("Erreur lors de la suppression");
  }
};

/**
 * Supprime un calcul de SharePoint
 */
async function deleteCalculationFromSharePoint(id) {
  try {
    const response = await fetch(`${_spPageContextInfo.webAbsoluteUrl}/_api/web/lists/getbytitle('CalculsTransport')/items(${id})`, {
      method: 'DELETE',
      headers: {
        'X-RequestDigest': document.getElementById('__REQUESTDIGEST').value,
        'IF-MATCH': '*'
      },
      credentials: 'include'
    });

    if (!response.ok) throw new Error('Échec de la suppression');
  } catch (error) {
    console.error('Erreur de suppression:', error);
    throw error;
  }
}

/**
 * Calcule le total général
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
    <h3>Total Général</h3>
    <p>Total Collecte: ${totals.collection.toFixed(2)} €</p>
    <p>Total Livraison: ${totals.delivery.toFixed(2)} €</p>
    <p>Total Ferry: ${totals.ferry.toFixed(2)} €</p>
    <p>Total Marge/Remise: ${totals.margin.toFixed(2)} €</p>
    <hr>
    <p><strong>Total Final: ${totals.grand.toFixed(2)} €</strong></p>
  `;
}

// ======================
// FONCTIONS UTILITAIRES
// ======================

/**
 * Réinitialise la carte
 */
window.resetMap = function() {
  // Masque les calculs sauvegardés
  document.getElementById('saved-calculations').style.display = 'none';
  document.querySelector('.show-total-btn').style.display = 'none';
  
  // Affiche la boîte de total
  document.getElementById('total-box').style.display = 'block';
  
  // Supprime les marqueurs et itinéraires
  markers.forEach(marker => map.removeLayer(marker));
  markers = [];
  
  if (routingControl1) map.removeControl(routingControl1);
  if (routingControl2) map.removeControl(routingControl2);

  // Réinitialise l'état
  selectionState.step = 1;
  selectionState.collectionStart = null;
  selectionState.ferryRoute = null;
  selectionState.deliveryEnd = null;
  CONFIG.ferryCost = 0;

  // Réinitialise l'UI
  updateStepUI();
  updateCurrentSelection();
  
  // Réinitialise les affichages
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
                          id.includes('from') || id.includes('to') ? 'Non défini' : '0 €';
    }
  });

  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-input').value = '';
  document.getElementById('ferry-select').value = '';
  document.getElementById('ferry-select').disabled = true;

  // Réinitialise le curseur de marge
  document.getElementById('margin-slider').value = 0;
  currentMargin = 0;
  updateMarginDisplay();

  // Réinitialise les prix
  updatePriceDisplays(
    CONFIG.collectionPricePerKm.toString(), 
    CONFIG.collectionMinPrice.toString()
  );

  setSelectionMode('map');
  hideMapError();
};

/**
 * Définit le mode de sélection
 */
window.setSelectionMode = function(mode) {
  selectionState.mode = mode;
  document.getElementById('map-mode-btn').classList.toggle('active', mode === 'map');
  document.getElementById('address-mode-btn').classList.toggle('active', mode === 'address');
};

/**
 * Affiche une erreur sur la carte
 */
function showMapError(message) {
  const errorElement = document.getElementById('map-error');
  if (errorElement) {
    errorElement.querySelector('p').textContent = message || "Erreur inconnue";
    errorElement.style.display = 'block';
  }
}

/**
 * Masque l'erreur sur la carte
 */
window.hideMapError = function() {
  const errorElement = document.getElementById('map-error');
  if (errorElement) {
    errorElement.style.display = 'none';
  }
};

// ======================
// GÉNÉRATION PDF
// ======================

/**
 * Génère un PDF avec les calculs sauvegardés
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

    // En-tête
    doc.setFontSize(20);
    doc.text('Calculs de Coût de Transport', 105, 15, { align: 'center' });

    // Date
    doc.setFontSize(12);
    doc.text(`Rapport généré le: ${new Date().toLocaleString()}`, 15, 25);
    
    let yPosition = 35;

    // Calculs sauvegardés
    if (savedCalculations.length > 0) {
      doc.setFontSize(16);
      doc.text('Calculs Sauvegardés:', 15, yPosition);
      yPosition += 10;
      
      savedCalculations.forEach((calc, index) => {
        // Nouvelle page si nécessaire
        if (yPosition > 250) {
          doc.addPage();
          yPosition = 20;
        }
        
        doc.setFontSize(12);
        doc.text(`Calcul #${index + 1}`, 15, yPosition);
        yPosition += 7;
        
        doc.text(`Date: ${calc.date}`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`De: ${selectionState.collectionStart?.name || 'Non spécifié'}`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`À: ${selectionState.deliveryEnd?.name || 'Non spécifié'}`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`Collecte: ${calc.collection}`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`Livraison: ${calc.delivery}`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`Ferry: ${calc.ferry}`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`Marge/Remise: ${calc.margin}`, 20, yPosition);
        yPosition += 7;
        
        doc.setFontSize(14);
        doc.text(`Total: ${calc.total}`, 20, yPosition);
        yPosition += 15;
        
        // Ligne de séparation
        doc.line(15, yPosition, 195, yPosition);
        yPosition += 10;
      });
      
      // Totaux généraux
      if (savedCalculations.length > 1) {
        doc.setFontSize(16);
        doc.text('Totaux Généraux:', 15, yPosition);
        yPosition += 10;
        
        const totals = {
          collection: savedCalculations.reduce((sum, calc) => sum + parseFloat(calc.collection.replace(' €', '')), 0),
          delivery: savedCalculations.reduce((sum, calc) => sum + parseFloat(calc.delivery.replace(' €', '')), 0),
          ferry: savedCalculations.reduce((sum, calc) => sum + parseFloat(calc.ferry.replace(' €', '')), 0),
          margin: savedCalculations.reduce((sum, calc) => sum + parseFloat(calc.margin.replace(' €', '')), 0),
          grand: savedCalculations.reduce((sum, calc) => sum + parseFloat(calc.total.replace(' €', '')), 0)
        };
        
        doc.setFontSize(12);
        doc.text(`Total Collecte: ${totals.collection.toFixed(2)} €`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`Total Livraison: ${totals.delivery.toFixed(2)} €`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`Total Ferry: ${totals.ferry.toFixed(2)} €`, 20, yPosition);
        yPosition += 7;
        
        doc.text(`Total Marge/Remise: ${totals.margin.toFixed(2)} €`, 20, yPosition);
        yPosition += 7;
        
        doc.setFontSize(14);
        doc.text(`Total Final: ${totals.grand.toFixed(2)} €`, 20, yPosition);
      }
    } else {
      doc.setFontSize(14);
      doc.text('Aucun calcul sauvegardé à afficher', 15, yPosition);
    }

    doc.save('calculs_transport.pdf');
  } catch (error) {
    console.error("Erreur de génération PDF:", error);
    showMapError("Erreur de génération du PDF");
  } finally {
    if (loadingElement) loadingElement.style.display = 'none';
  }
};

// ======================
// INITIALISATION
// ======================

// Attend que le DOM soit chargé
document.addEventListener('DOMContentLoaded', function() {
  // Vérifie que SharePoint est chargé
  if (typeof _spPageContextInfo === 'undefined') {
    console.error("SharePoint non détecté!");
    showMapError("Cette application doit s'exécuter dans SharePoint");
    return;
  }

  // Vérifie que Leaflet est chargé
  if (typeof L === 'undefined') {
    console.error("Leaflet non chargé!");
    showMapError("Erreur de chargement des bibliothèques");
    return;
  }

  // Initialise le système après un court délai
  setTimeout(async () => {
    try {
      initializeTransportSystem();
      await loadFerriesFromSharePoint();
      
      // Affiche les calculs sauvegardés s'il y en a
      if (savedCalculations.length > 0) {
        document.querySelector('.show-total-btn').style.display = 'inline-block';
        document.getElementById('saved-calculations').style.display = 'block';
      }
    } catch (error) {
      console.error("Erreur d'initialisation:", error);
      showMapError("Erreur d'initialisation");
    }
  }, 100);
});