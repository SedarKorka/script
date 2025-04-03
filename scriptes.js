'use strict';

// ======================
// CONFIGURATION
// ======================
const CONFIG = {
    SHAREPOINT_SITE_URL: "https://hendrickeuropean.sharepoint.com/sites/TestDeveloptment",
    FERRY_LIST_NAME: "FerryOverview",
    CALCULATIONS_LIST_NAME: "TransportCalculations",
    MAP: {
        CENTER: [46.603354, 1.888334], // Centre sur la France
        ZOOM: 6,
        TILE_LAYER: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        ATTRIBUTION: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    },
    PRICES: {
        COLLECTION_PER_KM: 2.5,
        COLLECTION_MIN: 450,
        DELIVERY_PER_KM: 3,
        DELIVERY_MIN: 300
    }
};

// ======================
// ÉTAT DE L'APPLICATION
// ======================
const state = {
    map: null,
    markers: [],
    routingControls: [],
    currentMargin: 0,
    savedCalculations: [],
    calculationId: 0,
    ferryTerminals: {},
    selection: {
        mode: 'map', // 'map' ou 'address'
        step: 1, // 1=Collecte, 2=Ferry, 3=Livraison
        collectionPoint: null,
        ferry: null,
        deliveryPoint: null
    }
};

// ======================
// INITIALISATION
// ======================

/**
 * Initialise l'application
 */
function initApplication() {
    try {
        // Vérifier les dépendances
        if (!checkDependencies()) {
            throw new Error("Dépendances manquantes");
        }

        // Initialiser la carte
        initMap();

        // Configurer les écouteurs d'événements
        setupEventListeners();

        // Charger les données initiales
        loadInitialData();

        console.log("Application initialisée avec succès");
    } catch (error) {
        showError(`Erreur d'initialisation: ${error.message}`);
    }
}

/**
 * Vérifie les dépendances requises
 */
function checkDependencies() {
    const missing = [];
    if (typeof L === 'undefined') missing.push("Leaflet");
    if (typeof L.Routing === 'undefined') missing.push("Leaflet Routing Machine");
    if (typeof jsPDF === 'undefined') missing.push("jsPDF");

    if (missing.length > 0) {
        showError(`Bibliothèques manquantes: ${missing.join(", ")}`);
        return false;
    }
    return true;
}

/**
 * Initialise la carte Leaflet
 */
function initMap() {
    state.map = L.map('map', {
        center: CONFIG.MAP.CENTER,
        zoom: CONFIG.MAP.ZOOM,
        preferCanvas: true
    });

    L.tileLayer(CONFIG.MAP.TILE_LAYER, {
        attribution: CONFIG.MAP.ATTRIBUTION,
        maxZoom: 19,
        detectRetina: true
    }).addTo(state.map);

    L.control.scale({ imperial: false, metric: true }).addTo(state.map);
}

// ======================
// GESTION DES DONNÉES
// ======================

/**
 * Charge les données initiales
 */
async function loadInitialData() {
    try {
        await loadFerries();
        updateUI();
    } catch (error) {
        showError(`Erreur de chargement des données: ${error.message}`);
    }
}

/**
 * Charge les ferries depuis SharePoint
 */
async function loadFerries() {
    showLoading("Chargement des ferries...");

    try {
        const endpoint = `${CONFIG.SHAREPOINT_SITE_URL}/_api/web/lists/getbytitle('${CONFIG.FERRY_LIST_NAME}')/items?$select=Title,DepartureTerminal,ArrivalTerminal,Price,PricePerKm,MinimumPrice,DepartureLat,DepartureLng,ArrivalLat,ArrivalLng`;
        
        const response = await fetch(endpoint, {
            headers: {
                'Accept': 'application/json;odata=nometadata',
                'Content-Type': 'application/json;odata=nometadata'
            },
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`Erreur ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        populateFerrySelect(data.value);
        
    } catch (error) {
        console.error("Erreur de chargement des ferries:", error);
        throw error;
    } finally {
        hideLoading();
    }
}

/**
 * Remplit le menu déroulant des ferries
 */
function populateFerrySelect(ferries) {
    const select = document.getElementById('ferry-select');
    select.innerHTML = '<option value="">-- Sélectionnez un ferry --</option>';

    ferries.forEach(ferry => {
        // Vérification des données requises
        if (!ferry.DepartureTerminal || !ferry.ArrivalTerminal || !ferry.Price) {
            console.warn("Données de ferry incomplètes:", ferry);
            return;
        }

        const option = document.createElement('option');
        const value = `${ferry.Price}|${ferry.DepartureTerminal}|${ferry.ArrivalTerminal}|${ferry.PricePerKm}|${ferry.MinimumPrice}`;
        
        option.value = value;
        option.textContent = `${ferry.Title}: ${ferry.DepartureTerminal} → ${ferry.ArrivalTerminal}`;
        select.appendChild(option);

        // Stockage des coordonnées des terminaux
        if (ferry.DepartureLat && ferry.DepartureLng) {
            state.ferryTerminals[ferry.DepartureTerminal] = {
                lat: parseFloat(ferry.DepartureLat),
                lng: parseFloat(ferry.DepartureLng)
            };
        }

        if (ferry.ArrivalLat && ferry.ArrivalLng) {
            state.ferryTerminals[ferry.ArrivalTerminal] = {
                lat: parseFloat(ferry.ArrivalLat),
                lng: parseFloat(ferry.ArrivalLng)
            };
        }
    });

    // Activer la sélection si déjà à l'étape 2
    if (state.selection.step >= 2) {
        select.disabled = false;
    }
}

// ======================
// GESTION DE L'INTERFACE
// ======================

/**
 * Met à jour l'interface utilisateur
 */
function updateUI() {
    updateStepIndicator();
    updateCurrentSelectionDisplay();
    updateCalculationDisplays();
}

/**
 * Met à jour l'indicateur d'étape
 */
function updateStepIndicator() {
    // Réinitialiser toutes les étapes
    document.querySelectorAll('.step').forEach(step => {
        step.classList.remove('active', 'completed', 'disabled');
    });

    // Marquer les étapes complétées
    for (let i = 1; i < state.selection.step; i++) {
        const stepElement = document.getElementById(`step${i}`);
        if (stepElement) stepElement.classList.add('completed');
    }

    // Marquer l'étape active
    const currentStep = document.getElementById(`step${state.selection.step}`);
    if (currentStep) currentStep.classList.add('active');

    // Désactiver les étapes futures
    for (let i = state.selection.step + 1; i <= 3; i++) {
        const stepElement = document.getElementById(`step${i}`);
        if (stepElement) stepElement.classList.add('disabled');
    }
}

/**
 * Met à jour l'affichage de la sélection courante
 */
function updateCurrentSelectionDisplay() {
    document.getElementById('current-collection').textContent = 
        state.selection.collectionPoint?.name || 'Non sélectionné';

    document.getElementById('current-ferry').textContent = 
        state.selection.ferry 
            ? `${state.selection.ferry.departure} → ${state.selection.ferry.arrival} (${state.selection.ferry.price}€)`
            : 'Non sélectionné';

    document.getElementById('current-delivery').textContent = 
        state.selection.deliveryPoint?.name || 'Non sélectionné';
}

// ======================
// GESTION DES ÉVÉNEMENTS
// ======================

/**
 * Configure les écouteurs d'événements
 */
function setupEventListeners() {
    // Curseur de marge
    document.getElementById('margin-slider').addEventListener('input', function() {
        state.currentMargin = parseInt(this.value);
        updateMarginDisplay();
        calculateTotal();
    });

    // Sélection du ferry
    document.getElementById('ferry-select').addEventListener('change', handleFerrySelection);

    // Boutons de mode
    document.getElementById('address-mode-btn').addEventListener('click', () => setSelectionMode('address'));
    document.getElementById('map-mode-btn').addEventListener('click', () => setSelectionMode('map'));

    // Clic sur la carte
    state.map.on('click', handleMapClick);

    // Boutons d'action
    document.querySelector('.reset-btn').addEventListener('click', resetApplication);
    document.querySelector('.pdf-btn').addEventListener('click', generatePDF);
    document.querySelector('.add-btn').addEventListener('click', saveCalculation);
    document.querySelector('.show-total-btn').addEventListener('click', toggleSavedCalculations);
}

/**
 * Gère le clic sur la carte
 */
async function handleMapClick(e) {
    if (state.selection.mode !== 'map') return;

    const { lat, lng } = e.latlng;

    try {
        // Afficher un marqueur temporaire
        const tempMarker = createMarker([lat, lng], 'temp');
        tempMarker.bindPopup("<b>Chargement...</b>").openPopup();

        // Obtenir le nom de l'adresse
        const name = await getAddressName(lat, lng);
        state.map.removeLayer(tempMarker);

        // Gérer selon l'étape actuelle
        if (state.selection.step === 1) {
            handleCollectionSelection(lat, lng, name);
        } else if (state.selection.step === 3) {
            handleDeliverySelection(lat, lng, name);
        }
    } catch (error) {
        console.error("Erreur de clic sur la carte:", error);
        showError("Erreur de sélection de l'emplacement");
    }
}

// ======================
// FONCTIONS PRINCIPALES
// ======================

/**
 * Gère la sélection du point de collecte
 */
function handleCollectionSelection(lat, lng, name) {
    state.selection.collectionPoint = { lat, lng, name };
    addPointToMap(lat, lng, name, 'collection');
    
    // Passer à l'étape suivante
    state.selection.step = 2;
    document.getElementById('ferry-select').disabled = false;
    
    updateUI();
}

/**
 * Gère la sélection du ferry
 */
function handleFerrySelection() {
    const select = document.getElementById('ferry-select');
    const selectedOption = select.options[select.selectedIndex];
    
    if (!selectedOption.value) return;

    const [price, departure, arrival, pricePerKm, minPrice] = selectedOption.value.split('|');
    
    // Mettre à jour la configuration des prix
    CONFIG.PRICES.COLLECTION_PER_KM = parseFloat(pricePerKm) || CONFIG.PRICES.COLLECTION_PER_KM;
    CONFIG.PRICES.COLLECTION_MIN = parseFloat(minPrice) || CONFIG.PRICES.COLLECTION_MIN;
    CONFIG.PRICES.DELIVERY_PER_KM = parseFloat(pricePerKm) || CONFIG.PRICES.DELIVERY_PER_KM;
    CONFIG.PRICES.DELIVERY_MIN = parseFloat(minPrice) || CONFIG.PRICES.DELIVERY_MIN;

    // Enregistrer la sélection
    state.selection.ferry = {
        price: parseFloat(price),
        departure,
        arrival
    };

    // Ajouter les terminaux à la carte
    addFerryTerminalsToMap(departure, arrival);

    // Passer à l'étape suivante
    state.selection.step = 3;
    
    updateUI();
    updatePriceDisplays();
}

/**
 * Gère la sélection du point de livraison
 */
function handleDeliverySelection(lat, lng, name) {
    if (!state.selection.ferry) {
        showError("Veuillez d'abord sélectionner un ferry");
        return;
    }

    state.selection.deliveryPoint = { lat, lng, name };
    addPointToMap(lat, lng, name, 'delivery');
    
    // Passer à l'étape suivante
    state.selection.step = 4;
    
    calculateRoutes();
    updateUI();
}

// ======================
// FONCTIONS UTILITAIRES
// ======================

/**
 * Affiche un message de chargement
 */
function showLoading(message) {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
        loadingElement.textContent = message;
        loadingElement.style.display = 'flex';
    }
}

/**
 * Masque le message de chargement
 */
function hideLoading() {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
        loadingElement.style.display = 'none';
    }
}

/**
 * Affiche un message d'erreur
 */
function showError(message) {
    const errorElement = document.getElementById('map-error');
    if (errorElement) {
        errorElement.querySelector('p').textContent = message;
        errorElement.style.display = 'block';
    }
}

/**
 * Masque le message d'erreur
 */
function hideError() {
    const errorElement = document.getElementById('map-error');
    if (errorElement) {
        errorElement.style.display = 'none';
    }
}

// Initialisation lorsque le DOM est prêt
document.addEventListener('DOMContentLoaded', function() {
    // Vérifier que nous sommes dans SharePoint
    if (typeof _spPageContextInfo === 'undefined') {
        console.warn("Contexte SharePoint non détecté, mode test activé");
        window._spPageContextInfo = {
            webAbsoluteUrl: CONFIG.SHAREPOINT_SITE_URL
        };
    }

    // Démarrer l'application
    initApplication();
});