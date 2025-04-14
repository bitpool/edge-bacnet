/**
 * This function captures the current state of the PrimeVue app and downloads it as an HTML file
 * Specifically designed for the Bitpool BACnet Inspector
 * @param {string} filename - The name of the downloaded file
 * @param {Object} [data] - Optional data model to use instead of extracting from Vue app
 */
const downloadPrimeVueAppAsHtml = (filename = "bacnet-inspector-snapshot.html", data = null) => {
  // Wait for Vue to finish updating the DOM
  return new Promise((resolve) => {
    // Use nextTick to ensure all Vue updates are complete
    Vue.nextTick(async () => {
      // Get app data either from parameter or by extracting from Vue app
      const appData = data || extractAppState();

      // Process the HTML to create a standalone file with UMD dependencies
      const processedHtml = await processPrimeVueHtml(appData);

      // Create a blob from the processed HTML content
      const blob = new Blob([processedHtml], { type: "text/html" });

      // Create a temporary URL for the blob
      const url = URL.createObjectURL(blob);

      // Create a link element to trigger the download
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;

      // Append the link to the document, click it, and remove it
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Release the URL object
      URL.revokeObjectURL(url);

      resolve(true);
    });
  });
};

/**
 * Process the HTML to make it standalone with PrimeVue UMD
 * @param {string} html - The raw HTML content
 * @param {Object} appData - The application data to include
 * @returns {string} - The processed HTML with all required UMD dependencies
 */
async function processPrimeVueHtml(appData) {
  const iconBase64Map = await getIconsAsBase64();

  // Create a new HTML template
  const newDoc = document.implementation.createHTMLDocument("Bitpool BACnet Inspector");

  // Set basic meta tags
  newDoc.head.innerHTML = `
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bitpool BACnet Inspector</title>
  `;

  // Add required scripts and CSS
  addDependencies(newDoc);

  // Create the app container
  const appDiv = newDoc.createElement("div");
  appDiv.id = "app";
  newDoc.body.appendChild(appDiv);


  // Add the captured app state and initialization script
  const initScript = newDoc.createElement("script");
  initScript.textContent = `
    // Initialize the app when document is ready
    const CAPTURED_APP_DATA = ${JSON.stringify(appData)};
    document.addEventListener('DOMContentLoaded', function() {
      const { createApp, ref } = Vue;
      // Create app with captured data
      const app = createApp({
      data() {
        return {
          tableData: CAPTURED_APP_DATA.tableData || [],
          loading: CAPTURED_APP_DATA.loading || false,
          totalRecords: CAPTURED_APP_DATA.totalRecords || 0,
          first: CAPTURED_APP_DATA.first || 0,
          lazyParams: CAPTURED_APP_DATA.lazyParams || {},
          siteName: CAPTURED_APP_DATA.siteName || 'BACnet Inspector',
          statCounts: CAPTURED_APP_DATA.statCounts || {},
          displayedRowsCount: CAPTURED_APP_DATA.displayedRowsCount || 0, // Track how many rows are visible
          filters: {
            global: { value: null, matchMode: "contains" },
            deviceID: { value: null, matchMode: "contains" },
            ObjectType: { value: null, matchMode: "contains" },
            objectInstance: { value: null, matchMode: "contains" },
            presentValue: { value: null, matchMode: "contains" },
            dataModelStatus: { value: null, matchMode: "contains" },
            pointName: { value: null, matchMode: "contains" },
            discoveredBACnetPointName: { value: null, matchMode: "contains" },
            displayName: { value: null, matchMode: "contains" },
            deviceName: { value: null, matchMode: "contains" },
            ipAddress: { value: null, matchMode: "contains" },
            area: { value: null, matchMode: "contains" },
            key: { value: null, matchMode: "contains" },
            topic: { value: null, matchMode: "contains" },
            lastSeen: { value: null, matchMode: "contains" },
            error: { value: null, matchMode: "contains" },
          },
          allColumns: [
            { field: "deviceID", header: "Device ID" },
            { field: "objectType", header: "Object Type" },
            { field: "objectInstance", header: "Object Instance" },
            { field: "presentValue", header: "Present Value" },
            { field: "dataModelStatus", header: "Data Model Status" },
            { field: "pointName", header: "Mapped Point Name" },
            { field: "discoveredBACnetPointName", header: "Discovered Point Name" },
            { field: "displayName", header: "Display Name" },
            { field: "deviceName", header: "Device Name" },
            { field: "ipAddress", header: "IP Address" },
            { field: "area", header: "Area" },
            { field: "key", header: "Key" },
            { field: "topic", header: "Topic" },
            { field: "lastSeen", header: "Last Seen" },
            { field: "error", header: "Error" }
          ],
          selectedColumns: CAPTURED_APP_DATA.selectedColumns || [],
          selectedColumnValues: CAPTURED_APP_DATA.selectedColumnValues || [],
          statPercentages: CAPTURED_APP_DATA.statPercentages || {
            readCount: 0,
            ok: 0,
            error: 0,
            missing: 0,
            warnings: 0,
            deviceIdChange: 0,
            deviceIdConflict: 0,
            unmapped: 0
          },
          activeFilter: null,
        };
      },
      setup() {
        return {};
      },
      mounted() {
        let app = this;
        this.selectedColumns = JSON.parse(JSON.stringify(this.allColumns));

        // Calculate percentages
        const total = this.tableData.length || 1; // Avoid division by zero
        this.statPercentages = {
          readCount: Math.round((this.statCounts.readCount / total) * 100),
          ok: Math.round((this.statCounts.statBlock.ok / total) * 100),
          error: Math.round((this.statCounts.statBlock.error / total) * 100),
          missing: Math.round((this.statCounts.statBlock.missing / total) * 100),
          warnings: Math.round((this.statCounts.statBlock.warnings / total) * 100),
          deviceIdChange: Math.round((this.statCounts.statBlock.deviceIdChange / total) * 100),
          deviceIdConflict: Math.round((this.statCounts.statBlock.deviceIdConflict / total) * 100 || 0),
          unmapped: Math.round((this.statCounts.statBlock.unmapped / total) * 100)
        };
      },
      computed: {
        visibleColumns() {
          return this.selectedColumns || []; // Handle null case
        },
        displayData() {
          if (!this.tableData || this.tableData.length === 0) {
            // Create empty rows to maintain height
            return Array(20).fill({}).map(() => ({}));
          }
          return this.tableData;
        }
      },
      methods: {
        statusItemClicked(e) {
          // Get the filter category from the clicked item's text content
          const clickedItem = e.currentTarget;
          const statusType = clickedItem.querySelector('.statBlockKey').textContent.trim();

          // Clear previous active status styling
          document.querySelectorAll('.statusItem').forEach(item => {
            item.classList.remove('active-filter');
          });

          // If clicking the already active filter, clear it
          if (this.activeFilter === statusType) {
            this.activeFilter = null;
            this.filters['dataModelStatus'].value = null;
            return;
          }

          // Set this item as active
          clickedItem.classList.add('active-filter');
          this.activeFilter = statusType;

          // Apply the appropriate filter based on which status item was clicked
          let filterValue = '';
          switch (statusType) {
            case 'Points OK':
              filterValue = 'Point Ok';
              break;
            case 'Points Error':
              filterValue = 'Point Error';
              break;
            case 'Points Missing':
              filterValue = 'Point Missing';
              break;
            case 'Points Warnings':
              filterValue = 'Point Warning';
              break;
            case 'Points Unmapped':
              filterValue = 'Point Unmapped';
              break;
            case "Changed Device ID's":
              filterValue = 'Device ID Changed';
              break;
            case "Conflicting Device ID's":
              filterValue = 'Device ID Conflict';
              break;
            default:
              filterValue = '';
          }

          // Apply the filter
          this.filters['dataModelStatus'].value = filterValue;
        },
        enforceTableHeight() {
          // Force minimum height on table elements
          const tableWrapper = document.querySelector('.p-datatable-wrapper');
          if (tableWrapper) {
            tableWrapper.style.minHeight = '800px';
          }

          const tableBody = document.querySelector('.p-datatable-tbody');
          if (tableBody) {
            tableBody.style.minHeight = '760px';
          }
        },
        isSelected(option) {
          if (!this.selectedColumns) return false;
          return this.selectedColumns.some(item => item.field === option.field);
        },
        getRowClass(rowData) {
          console.log("rowData", rowData);
          if (rowData.dataModelStatus.includes("Point OK")) return "row-ok";
          if (rowData.dataModelStatus.includes("Point Error")) return "row-error";
          if (rowData.dataModelStatus.includes("Point Warning")) return "row-warning";
          if (rowData.dataModelStatus.includes("Point Missing")) return "row-missing";
          return ""; // Default, no class
        },
        onFilter(e) {
          // e.filteredValue contains the new filtered dataset
          if (e.filteredValue) {
            this.displayedRowsCount = e.filteredValue.length;
          } else {
            // if no filter is applied, revert to full tableData length
            this.displayedRowsCount = this.tableData ? this.tableData.length : 0;
          }

          this.$nextTick(() => {
            this.enforceTableHeight();
          });
        },
      },
      components: {
        "p-button": PrimeVue.Button,
        "p-card": PrimeVue.Card,
        "p-input-text": PrimeVue.InputText,
        "p-datatable": PrimeVue.DataTable,
        "p-column": PrimeVue.Column,
        "p-icon-field": PrimeVue.IconField,
        "p-input-icon": PrimeVue.InputIcon,
        "p-multiselect": PrimeVue.MultiSelect
      },
    });

    app.use(PrimeVue.Config);
      
      // Initialize the app template
      document.getElementById('app').innerHTML = \`
        <div class="card header-content">
          <div class="header">
            <div class="dividerRight">
              <img src="data:image/svg+xml;base64,${await getLogoAsBase64()}" class="logo" alt="Bitpool" />
            </div>
            <div class="status">
              <span @click="statusItemClicked" class="statusItem status-with-icon">
                <span class="status-icon-wrapper" style="background-color: #10B981;">
                  <img src="data:image/svg+xml;base64,${iconBase64Map.ok}" class="status-icon ok-icon" alt="Points OK" />
                </span>
                <div class="status-text">
                  <span class="statBlockValue">
                    {{statCounts?.statBlock.ok}}
                    <span class="stat-percentage">{{statPercentages.ok}}%</span>
                  </span>
                  <span class="statBlockKey">Points OK</span>
                </div>
              </span>
              <span @click="statusItemClicked" class="statusItem status-with-icon">
                <span class="status-icon-wrapper" style="background-color: #F1707B;">
                  <img src="data:image/svg+xml;base64,${iconBase64Map.error}" class="status-icon error-icon" alt="Points Error" />
                </span>
                <div class="status-text">
                  <span class="statBlockValue">
                    {{statCounts?.statBlock.error}}
                    <span class="stat-percentage">{{statPercentages.error}}%</span>
                  </span>
                  <span class="statBlockKey">Points Error</span>
                </div>
              </span>
              <span @click="statusItemClicked" class="statusItem status-with-icon">
                <span class="status-icon-wrapper" style="background-color: #133547;">
                  <img src="data:image/svg+xml;base64,${iconBase64Map.missing}" class="status-icon missing-icon" alt="Points Missing" />
                </span>
                <div class="status-text">
                  <span class="statBlockValue">
                    {{statCounts?.statBlock.missing}}
                    <span class="stat-percentage">{{statPercentages.missing}}%</span>
                  </span>
                  <span class="statBlockKey">Points Missing</span>
                </div>
              </span>
              <span @click="statusItemClicked" class="statusItem status-with-icon">
                <span class="status-icon-wrapper" style="background-color: #F59E0B;">
                  <img src="data:image/svg+xml;base64,${iconBase64Map.warning}" class="status-icon warning-icon" alt="Points Warning" />
                </span>
                <div class="status-text">
                  <span class="statBlockValue">
                    {{statCounts?.statBlock.warnings}}
                    <span class="stat-percentage">{{statPercentages.warnings}}%</span>
                  </span>
                  <span class="statBlockKey">Points Warnings</span>
                </div>
              </span>
              <span @click="statusItemClicked" class="statusItem status-with-icon">
                <span class="status-icon-wrapper" style="background-color: #00ADEF;">
                  <img src="data:image/svg+xml;base64,${iconBase64Map.unmapped}" class="status-icon unmapped-icon" alt="Points Unmapped" />
                </span>
                <div class="status-text">
                  <span class="statBlockValue">
                    {{statCounts?.statBlock.unmapped}}
                    <span class="stat-percentage">{{statPercentages.unmapped}}%</span>
                  </span>
                  <span class="statBlockKey">Points Unmapped</span>
                </div>
              </span>
              <span @click="statusItemClicked" class="statusItem status-with-icon">
                <span class="status-icon-wrapper" style="background-color: #0689BC;">
                  <img src="data:image/svg+xml;base64,${iconBase64Map.deviceIdChange}" class="status-icon device-id-change-icon" alt="Device ID Change" />
                </span>
                <div class="status-text">
                  <span class="statBlockValue">
                    {{statCounts?.statBlock.deviceIdChange}}
                    <span class="stat-percentage">{{statPercentages.deviceIdChange}}%</span>
                  </span>
                  <span class="statBlockKey">Changed Device ID's</span>
                </div>
              </span>
              <span @click="statusItemClicked" class="statusItem status-with-icon">
                <span class="status-icon-wrapper" style="background-color: #406C7D;">
                  <img src="data:image/svg+xml;base64,${iconBase64Map.deviceIdConflict}"
                    class="status-icon device-id-conflict-icon" alt="Device ID Conflict" />
                </span>
                <div class="status-text">
                  <span class="statBlockValue">
                    {{statCounts?.statBlock.deviceIdConflict}}
                    <span class="stat-percentage">{{statPercentages.deviceIdConflict}}%</span>
                  </span>
                  <span class="statBlockKey">Conflicting Device ID's</span>
                </div>
              </span>
            </div>
            <div class="actionButtons">
            </div>
          </div>
          
        </div>
        <div class="content-wrapper">
          <div class="card datatable-card">
            <div class="center">
              <p class="headertext">{{siteName}} - Point Status Display</p>
            </div>
            <p-datatable :value="displayData" paginator :rows="12" filterDisplay="menu" :filters="filters"
              v-model:filters="filters" :sortMode="'multiple'" @filter="onFilter" scrollable scrollHeight="800px"
              class="datatable fixed-height-table">
              <template #header>
                <div class="tableHeaderDiv">
                  <div style="margin-right: 5px">
                    <p-multiselect v-model="selectedColumns" :options="allColumns"
                      optionLabel="header" dataKey="field" placeholder="Select Columns" :maxSelectedLabels="3"
                      class="columnSelector w-full md:w-20rem" display="chip">

                      <template #option="slotProps">
                        <div style="display: flex; align-items: center;">
                          <div class="custom-checkbox">
                            <div :class="['custom-checkbox-box', {'selected': isSelected(slotProps.option)}]">
                              <i v-if="isSelected(slotProps.option)" class="pi pi-check custom-checkbox-icon"></i>
                            </div>
                          </div>
                          <span>{{ slotProps.option.header }}</span>
                        </div>
                      </template>

                      <template #value="slotProps">
                        <template v-if="slotProps.value && slotProps.value.length > 0">
                          <template v-if="slotProps.value.length <= 3">
                            <div class="p-multiselect-token" v-for="(item, index) in slotProps.value" :key="item.field">
                              <span class="p-multiselect-token-label">{{ item.header }}</span>
                              <span v-if="index < slotProps.value.length - 1">, </span>
                            </div>
                          </template>
                          <template v-else>
                            <div class="p-multiselect-token-label">{{ slotProps.value.length }} items selected</div>
                          </template>
                        </template>
                        <span v-else class="p-multiselect-placeholder">{{ 'Select Columns' }}</span>
                      </template>
                    </p-multiselect>
                  </div>

                  <div style="width: 100%">
                    <i class="pi pi-search searchBarContainer"></i>
                    <p-input-text class="searchBar" type="text" pInputText v-model="filters['global'].value"
                      placeholder="Search"></p-input-text>
                  </div>
                </div>

              </template>
              <p-column v-for="col in visibleColumns" :key="col.field" :field="col.field" :header="col.header" sortable
                filter></p-column>
              <template #paginatorstart>
              </template>
              <template #paginatorend="slotProps">
                <span class="">
                  <span class="statBlockValue">{{displayedRowsCount}} results</span>
                </span>
              </template>
            </p-datatable>
          </div>
        </div>
      \`;
      
      // Mount the app
      app.mount('#app');
    });
  `;

  newDoc.body.appendChild(initScript);

  // Add styles directly from the current document
  const stylesText = await extractAllStyles();
  const style = newDoc.createElement("style");
  style.textContent = stylesText;
  newDoc.head.appendChild(style);

  // Return the complete HTML document
  return "<!DOCTYPE html>" + newDoc.documentElement.outerHTML;
}

/**
 * Add all required dependencies to the document
 * @param {Document} doc - The HTML document
 */
function addDependencies(doc) {
  // Get all scripts from current document
  const scripts = document.querySelectorAll('script');

  // Get Vue script
  const vueScriptSrc = Array.from(scripts)
    .find(script => script.src.includes('vue') && script.src.includes('global.prod.js'))?.src
    || "resources/@bitpoolos/edge-bacnet/vue3513.global.prod.js";

  // Add Vue 3
  const vueScript = doc.createElement("script");
  vueScript.src = vueScriptSrc;
  doc.head.appendChild(vueScript);

  // Get PrimeVue script
  const primeVueScriptSrc = Array.from(scripts)
    .find(script => script.src.includes('primevue.min.js'))?.src
    || "resources/@bitpoolos/edge-bacnet/primevue.min.js";

  // Add PrimeVue UMD
  const primeVueScript = doc.createElement("script");
  primeVueScript.src = primeVueScriptSrc;
  doc.head.appendChild(primeVueScript);

  // Get all stylesheets from current document
  const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');

  // Map of stylesheet types we want to include
  const stylesheetTypes = [
    { name: 'primevue-saga-blue-theme', src: 'resources/@bitpoolos/edge-bacnet/primevue-saga-blue-theme.css' },
    { name: 'primevue.min', src: 'resources/@bitpoolos/edge-bacnet/primevue.min.css' },
    { name: 'primeflex.min', src: 'resources/@bitpoolos/edge-bacnet/primeflex.min.css' },
    { name: 'primeicons', src: 'resources/@bitpoolos/edge-bacnet/primeicons.css' },
    { name: 'inspectorStyles', src: 'resources/@bitpoolos/edge-bacnet/inspectorStyles.css' }
  ];

  // Add each stylesheet
  stylesheetTypes.forEach(styleType => {
    // Try to find in document first
    const stylesheet = Array.from(stylesheets)
      .find(link => link.href.includes(styleType.name));

    const cssLink = doc.createElement("link");
    cssLink.rel = "stylesheet";
    cssLink.href = stylesheet ? stylesheet.href : styleType.src;
    doc.head.appendChild(cssLink);
  });
}

/**
 * Extract all styles from the current document
 * @returns {Promise<string>} - Combined CSS content
 */
async function extractAllStyles() {
  let cssText = "";

  // Get inline styles
  document.querySelectorAll("style").forEach((style) => {
    cssText += style.textContent + "\n";
  });

  // Try to get linked stylesheets
  const styleSheets = document.querySelectorAll('link[rel="stylesheet"]');
  for (const sheet of styleSheets) {
    try {
      const response = await fetch(sheet.href);
      if (response.ok) {
        const text = await response.text();
        cssText += text + "\n";
      }
    } catch (error) {
      console.warn(`Could not fetch stylesheet ${sheet.href}:`, error);
    }
  }

  return cssText;
}

/**
 * Extract the current application state
 * @returns {Object} - The application state
 */
function extractAppState() {
  // Try to find the Vue app instance
  const appElement = document.getElementById("app");
  if (!appElement || !appElement.__vue_app__) {
    console.warn("Vue app instance not found");
    return {};
  }

  // Get the Vue instance
  const vueApp = appElement.__vue_app__;

  // Get component instance
  let componentInstance = null;
  if (vueApp._instance && vueApp._instance.data) {
    componentInstance = vueApp._instance;
  } else if (vueApp._container && vueApp._container.__vue__) {
    componentInstance = vueApp._container.__vue__;
  }

  if (!componentInstance) {
    console.warn("Vue component instance not found");
    return {};
  }

  // Extract data from component
  const appData = {};

  // Try different ways to access the component data
  if (componentInstance.data) {
    // Get key data properties
    const data = componentInstance.data;

    // Copy important properties
    appData.tableData = data.tableData;
    appData.siteName = data.siteName;
    appData.statCounts = data.statCounts;
    appData.displayedRowsCount = data.displayedRowsCount;
    appData.filters = data.filters;
  }

  return appData;
}

async function getIconsAsBase64() {
  const icons = {
    ok: 'points-ok-icon.svg',
    error: 'points-error-icon.svg',
    missing: 'points-missing-icon.svg',
    warning: 'points-warning-icon.svg',
    deviceIdChange: 'device-id-change-icon.svg',
    unmapped: 'points-unmapped-icon.svg',
    deviceIdConflict: 'device-id-conflict-icon.svg'
  };

  const iconBase64Map = {};

  for (const [key, filename] of Object.entries(icons)) {
    try {
      const response = await fetch(`resources/@bitpoolos/edge-bacnet/icons/${filename}`);
      if (!response.ok) continue;

      const blob = await response.blob();
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });

      iconBase64Map[key] = base64;
    } catch (error) {
      console.error(`Error converting ${filename} to base64:`, error);
      iconBase64Map[key] = '';
    }
  }

  return iconBase64Map;
}

/**
 * Get the Bitpool logo as base64 to embed it in the HTML
 * @returns {Promise<string>} - Base64 encoded logo
 */
async function getLogoAsBase64() {
  try {
    // Find the logo in the current document
    const logoImg = document.querySelector(".logo");
    if (!logoImg) {
      return ""; // No logo found
    }

    // Fetch the logo image
    const response = await fetch(logoImg.src);
    if (!response.ok) {
      return ""; // Failed to fetch
    }

    // Get the image as blob
    const blob = await response.blob();

    // Convert blob to Base64
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // Strip the data URL prefix (data:image/svg+xml;base64,)
        const base64 = reader.result.split(",")[1];
        resolve(base64);
      };
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("Error converting logo to base64:", error);
    return "";
  }
}
