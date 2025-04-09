/**
 * Exports PrimeVue apps as standalone HTML files
 * Generates static HTML that can be viewed without a server
 */

/**
 * Generate a standalone HTML file from a PrimeVue app using SSR
 * @param {Object} appData - The application data to render
 * @param {string} filename - The output filename
 * @param {Object} options - Additional options for rendering
 * @returns {Promise<string>} - The generated HTML content
 */
async function generatePrimeVueAppHtmlStatic(appData, filename = "bacnet-inspector-snapshot.html", options = {}) {
  const {
    title = "Bitpool BACnet Inspector",
    logoBase64 = null,
    customStyles = "",
  } = options;

  // Get embedded dependencies
  const embeddedDependencies = await getEmbeddedDependencies();
  const iconBase64Map = await getIconsAsBase64();

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  
  <!-- Embedded styles -->
  <style>
    ${embeddedDependencies.styles.theme || ''}
    ${embeddedDependencies.styles.primevue || ''}
    ${embeddedDependencies.styles.primeflex || ''}
    ${embeddedDependencies.styles.primeicons || ''}
    ${embeddedDependencies.styles.inspector || ''}
    ${customStyles}
  </style>
</head>
<body>
  <div id="app">
    <div class="card header-content">
      <div class="header">
        <div class="dividerRight">
          <img :src="'data:image/svg+xml;base64,${logoBase64 || ""}'" class="logo" alt="Bitpool" />
        </div>
        <div class="status">
          <span @click="statusItemClicked" class="statusItem status-with-icon">
            <span class="status-icon-wrapper" style="background-color: #10B981;">
              <img src="data:image/svg+xml;base64,${iconBase64Map.ok}" class="status-icon ok-icon" alt="Points OK" />
            </span>
            <div class="status-text">
              <span class="statBlockValue">
                {{statCounts?.readCount}}
                <span class="stat-percentage">{{statPercentages.readCount}}%</span>
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
              <img src="data:image/svg+xml;base64,${iconBase64Map.deviceIdConflict || ''}" class="status-icon device-id-conflict-icon" alt="Device ID Conflict" />
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
      </div>
    </div>
    <div class="content-wrapper">
      <div class="card datatable-card">
        <div class="center">
          <p class="headertext">{{siteName}} - Point Status Display</p>
        </div>
        <p-datatable :value="tableData" paginator :rows="12" filterDisplay="menu" :filters="filters"
          v-model:filters="filters" :sortMode="'multiple'" @filter="onFilter" scrollable scrollHeight="800px"
          class="datatable fixed-height-table">
          <template #header>
            <div class="tableHeaderDiv">
              <div style="margin-right: 5px">
                <p-multiselect v-model="selectedColumns" :options="allColumns" optionLabel="header" dataKey="field"
                  placeholder="Select Columns" :maxSelectedLabels="3" class="columnSelector w-full md:w-20rem"
                  display="chip">

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
  </div>
  
  <!-- Embedded scripts -->
  <script>${embeddedDependencies.scripts.vue || ''}</script>
  <script>${embeddedDependencies.scripts.primevue || ''}</script>
  
  <script>
    window.appData = ${JSON.stringify(appData)};
    document.addEventListener('DOMContentLoaded', function() {

      const { createApp } = Vue;    
      const app = createApp({
        data() {
          return {
            tableData: window.appData.tableData || [],
            filteredData: window.appData.tableData || [],
            loading: false,
            totalRecords: window.appData.tableData?.length || 0,
            first: 0,
            rows: 12,
            lazyParams: {},
            siteName: window.appData.siteName || "BACnet Inspector",
            statCounts: window.appData.statCounts || {},
            displayedRowsCount: window.appData.tableData?.length || 0,
            filters: {
              global: { value: null, matchMode: "contains" },
              deviceID: { value: null, matchMode: "contains" },
              objectType: { value: null, matchMode: "contains" },
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
              { field: "error", header: "Error" },
            ],
            selectedColumns: [],
            statPercentages: {
              readCount: 0,
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
        mounted() {
          this.selectedColumns = JSON.parse(JSON.stringify(this.allColumns));
          if(window.appData.tableData.length > 0) {
            this.tableData = window.appData.tableData;
          }
          
          // Calculate percentages
          const total = this.tableData.length || 1; // Avoid division by zero
          this.statPercentages = {
            readCount: Math.round((this.statCounts.readCount / total) * 100) || 0,
            error: Math.round((this.statCounts.statBlock?.error / total) * 100) || 0,
            missing: Math.round((this.statCounts.statBlock?.missing / total) * 100) || 0,
            warnings: Math.round((this.statCounts.statBlock?.warnings / total) * 100) || 0,
            deviceIdChange: Math.round((this.statCounts.statBlock?.deviceIdChange / total) * 100) || 0,
            deviceIdConflict: Math.round((this.statCounts.statBlock?.deviceIdConflict / total) * 100) || 0,
            unmapped: Math.round((this.statCounts.statBlock?.unmapped / total) * 100) || 0
          };
        },
        computed: {
          visibleColumns() {
            return this.selectedColumns || this.allColumns;
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
          isSelected(option) {
            if (!this.selectedColumns) return false;
            return this.selectedColumns.some((item) => item.field === option.field);
          },
          getRowClass(rowData) {
            if (!rowData || !rowData.dataModelStatus) return "";
            if (rowData.dataModelStatus.includes("Point OK")) return "row-ok";
            if (rowData.dataModelStatus.includes("Point Error")) return "row-error";
            if (rowData.dataModelStatus.includes("Point Warning")) return "row-warning";
            if (rowData.dataModelStatus.includes("Point Missing")) return "row-missing";
            return "";
          },
          onGlobalFilterChange(event) {
            const value = event.target.value;
            this.filters.global.value = value;
            if (this.$refs.dt) {
              this.$refs.dt.filter(value, "global", "contains");
            }
          },
          onFilter(e) {
            this.displayedRowsCount = e.filteredValue ? e.filteredValue.length : 0;
          },
          onPage(event) {
            this.first = event.first;
            this.rows = event.rows;
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
      app.mount('#app');
    });
  </script>
</body>
</html>`;

  return fullHtml;
}

/**
 * In a Node.js environment, fetch the logo and convert to base64
 * @param {string} logoPath - Path to the logo file
 * @returns {Promise<string>} - Base64 encoded logo
 */
async function getLogoAsBase64(logoPath) {
  // In Node.js environment
  if (typeof window === "undefined" && logoPath) {
    try {
      const fs = require("fs");
      const logoData = fs.readFileSync(logoPath);
      return Buffer.from(logoData).toString("base64");
    } catch (error) {
      console.error("Error reading logo file:", error);
      return "";
    }
  }

  // In browser environment (if somehow used there)
  if (typeof window !== "undefined" && logoPath) {
    try {
      const response = await fetch(logoPath);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(",")[1];
          resolve(base64);
        };
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error("Error fetching logo:", error);
      return "";
    }
  }

  return "";
}

async function getIconsAsBase64() {
  const fs = require('fs');
  const path = require('path');

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
      // Construct the full path to the icon file
      const iconPath = path.join(__dirname, 'resources/icons', filename);

      // Read the file synchronously
      const fileContent = fs.readFileSync(iconPath, 'utf8');

      // Convert SVG content to base64
      const base64 = Buffer.from(fileContent).toString('base64');

      iconBase64Map[key] = base64;
    } catch (error) {
      console.error(`Error reading ${filename}:`, error);
      iconBase64Map[key] = '';
    }
  }

  return iconBase64Map;
}

/**
 * Get embedded dependencies content for the PrimeVue app
 * @returns {Object} - Object with embedded scripts and styles
 */
async function getEmbeddedDependencies() {
  const fs = require('fs');
  const path = require('path');

  // Define files to embed
  const dependencyFiles = {
    scripts: [
      { name: 'vue', path: path.join(__dirname, "resources", "vue3513.global.prod.js") },
      { name: 'primevue', path: path.join(__dirname, 'resources', 'primevue.min.js') }
    ],
    styles: [
      { name: 'theme', path: path.join(__dirname, 'resources', 'primevue-saga-blue-theme.css') },
      { name: 'primevue', path: path.join(__dirname, 'resources', 'primevue.min.css') },
      { name: 'primeflex', path: path.join(__dirname, 'resources', 'primeflex.min.css') },
      { name: 'primeicons', path: path.join(__dirname, 'resources', 'primeicons.css') },
      { name: 'inspector', path: path.join(__dirname, 'resources', 'inspectorStyles.css') }
    ]
  };

  // Read and collect dependencies
  const embeddedContent = {
    scripts: {},
    styles: {}
  };

  // Read script files
  for (const script of dependencyFiles.scripts) {
    try {
      embeddedContent.scripts[script.name] = fs.readFileSync(script.path, 'utf8');
    } catch (error) {
      console.error(`Error reading script file ${script.name}:`, error);
      embeddedContent.scripts[script.name] = `console.error("Failed to load ${script.name}");`;
    }
  }

  // Read style files
  for (const style of dependencyFiles.styles) {
    try {
      embeddedContent.styles[style.name] = fs.readFileSync(style.path, 'utf8');
    } catch (error) {
      console.error(`Error reading style file ${style.name}:`, error);
      embeddedContent.styles[style.name] = `/* Failed to load ${style.name} */`;
    }
  }

  return embeddedContent;
}

module.exports = {
  generatePrimeVueAppHtmlStatic,
  getLogoAsBase64,
};
