const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gcs", {
  jobs: {
    getAll: () => ipcRenderer.invoke("jobs:getAll"),
    create: (d) => ipcRenderer.invoke("jobs:create", d),
    update: (id, u) => ipcRenderer.invoke("jobs:update", { id, updates: u }),
    delete: (id) => ipcRenderer.invoke("jobs:delete", id)
  },
  customers: {
    getAll: () => ipcRenderer.invoke("customers:getAll"),
    create: (d) => ipcRenderer.invoke("customers:create", d),
    update: (id, u) => ipcRenderer.invoke("customers:update", { id, updates: u }),
    delete: (id) => ipcRenderer.invoke("customers:delete", id)
  },
  kb: {
    getAll: () => ipcRenderer.invoke("kb:getAll"),
    addEntry: (cat, entry) => ipcRenderer.invoke("kb:addEntry", { category: cat, entry }),
    updateEntry: (cat, id, u) => ipcRenderer.invoke("kb:updateEntry", { category: cat, id, updates: u }),
    deleteEntry: (cat, id) => ipcRenderer.invoke("kb:deleteEntry", { category: cat, id })
  },
  vehicles: {
    getAll: () => ipcRenderer.invoke("vehicles:getAll"),
    create: (d) => ipcRenderer.invoke("vehicles:create", d),
    update: (id, u) => ipcRenderer.invoke("vehicles:update", { id, updates: u }),
    delete: (id) => ipcRenderer.invoke("vehicles:delete", id)
  },
  files: {
    pick: () => ipcRenderer.invoke("files:pick"),
    open: (storedName) => ipcRenderer.invoke("files:open", storedName),
    showInFolder: (storedName) => ipcRenderer.invoke("files:showInFolder", storedName),
    delete: (storedName) => ipcRenderer.invoke("files:delete", storedName),
    getPath: (storedName) => ipcRenderer.invoke("files:getPath", storedName),
    previewData: (storedName) => ipcRenderer.invoke("files:previewData", storedName)
  },
  invoice: {
    generate: (data) => ipcRenderer.invoke("invoice:generate", data),
    save: (sourcePath, suggestedName) => ipcRenderer.invoke("invoice:save", { sourcePath, suggestedName }),
    open: (filePath) => ipcRenderer.invoke("invoice:open", filePath),
    getNextNumber: () => ipcRenderer.invoke("invoice:getNextNumber"),
    incrementNumber: () => ipcRenderer.invoke("invoice:incrementNumber")
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (u) => ipcRenderer.invoke("settings:update", u)
  },
  data: {
    export: () => ipcRenderer.invoke("data:export"),
    import: () => ipcRenderer.invoke("data:import"),
    backupDatabase: () => ipcRenderer.invoke("data:backupDatabase"),
    getStorePath: () => ipcRenderer.invoke("data:getStorePath"),
    openStoreFolder: () => ipcRenderer.invoke("data:openStoreFolder")
  },
  server: {
    loadConfig: () => ipcRenderer.invoke("server:loadConfig"),
    saveConfig: (cfg) => ipcRenderer.invoke("server:saveConfig", cfg),
    healthCheck: (url) => ipcRenderer.invoke("server:healthCheck", url),
    login: (url, username, password) => ipcRenderer.invoke("server:login", { url, username, password }),
    logout: () => ipcRenderer.invoke("server:logout"),
    isConnected: () => ipcRenderer.invoke("server:isConnected"),
    request: (method, path, body) => ipcRenderer.invoke("server:request", { method, path, body }),
    getBaseUrl: () => ipcRenderer.invoke("server:getBaseUrl"),
    jobs: {
      getAll: () => ipcRenderer.invoke("server:jobs:getAll"),
      create: (d) => ipcRenderer.invoke("server:jobs:create", d),
      update: (id, u) => ipcRenderer.invoke("server:jobs:update", { id, updates: u }),
      delete: (id) => ipcRenderer.invoke("server:jobs:delete", id)
    },
    customers: {
      getAll: () => ipcRenderer.invoke("server:customers:getAll"),
      create: (d) => ipcRenderer.invoke("server:customers:create", d),
      update: (id, u) => ipcRenderer.invoke("server:customers:update", { id, updates: u }),
      delete: (id) => ipcRenderer.invoke("server:customers:delete", id)
    },
    kb: {
      getAll: () => ipcRenderer.invoke("server:kb:getAll"),
      addEntry: (cat, entry) => ipcRenderer.invoke("server:kb:addEntry", { category: cat, entry }),
      deleteEntry: (cat, id) => ipcRenderer.invoke("server:kb:deleteEntry", { category: cat, id })
    },
    vehicles: {
      getAll: () => ipcRenderer.invoke("server:vehicles:getAll"),
      create: (d) => ipcRenderer.invoke("server:vehicles:create", d),
      delete: (id) => ipcRenderer.invoke("server:vehicles:delete", id)
    },
    users: {
      getAll: () => ipcRenderer.invoke("server:users:getAll"),
      create: (d) => ipcRenderer.invoke("server:users:create", d),
      update: (id, data) => ipcRenderer.invoke("server:users:update", { id, data }),
      delete: (id) => ipcRenderer.invoke("server:users:delete", id)
    },
    changePassword: (cur, next) => ipcRenderer.invoke("server:changePassword", { currentPassword: cur, newPassword: next }),
    settings: {
      get: () => ipcRenderer.invoke("server:settings:get")
    },
    invoice: {
      getNextNumber: () => ipcRenderer.invoke("server:invoice:getNextNumber"),
      incrementNumber: () => ipcRenderer.invoke("server:invoice:incrementNumber")
    },
    stripe: {
      configStatus: () => ipcRenderer.invoke("server:stripe:configStatus"),
      test: (apiKey) => ipcRenderer.invoke("server:stripe:test", apiKey),
      configure: (apiKey) => ipcRenderer.invoke("server:stripe:configure", apiKey),
      createPaymentLink: (data) => ipcRenderer.invoke("server:stripe:createPaymentLink", data),
      paymentStatus: (linkId) => ipcRenderer.invoke("server:stripe:paymentStatus", linkId),
      links: () => ipcRenderer.invoke("server:stripe:links")
    },
    files: {
      pick: () => ipcRenderer.invoke("server:files:pick"),
      open: (storedName) => ipcRenderer.invoke("server:files:open", storedName),
      showInFolder: (storedName) => ipcRenderer.invoke("server:files:showInFolder", storedName),
      getPath: (storedName) => ipcRenderer.invoke("server:files:getPath", storedName),
      previewData: (storedName) => ipcRenderer.invoke("server:files:previewData", storedName)
    },
    email: {
      configStatus: () => ipcRenderer.invoke("server:email:configStatus"),
      configure: (data) => ipcRenderer.invoke("server:email:configure", data),
      test: (data) => ipcRenderer.invoke("server:email:test", data),
      sendInvoice: (data) => ipcRenderer.invoke("server:email:sendInvoice", data)
    },
    estimates: {
      getAll: () => ipcRenderer.invoke("server:estimates:getAll"),
      create: (d) => ipcRenderer.invoke("server:estimates:create", d),
      update: (id, d) => ipcRenderer.invoke("server:estimates:update", { id, data: d }),
      delete: (id) => ipcRenderer.invoke("server:estimates:delete", id),
      convert: (id) => ipcRenderer.invoke("server:estimates:convert", id)
    },
    agreements: {
      getAll: () => ipcRenderer.invoke("server:agreements:getAll"),
      create: (d) => ipcRenderer.invoke("server:agreements:create", d)
    }
  }
});
