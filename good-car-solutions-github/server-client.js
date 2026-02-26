/**
 * GCS Server API Client
 * Handles HTTP communication with the GCS data server
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

class ServerClient {
  constructor() {
    this.baseUrl = "";
    this.token = "";
    this.user = null;
    this.connected = false;
  }

  configure(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token || "";
  }

  async request(method, endpoint, body) {
    const url = `${this.baseUrl}/api${endpoint}`;
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === "https:" ? https : http;

      const opts = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: method,
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
        },
        timeout: 10000
      };

      const req = mod.request(opts, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(json.error || `HTTP ${res.statusCode}`));
            } else {
              resolve(json);
            }
          } catch (e) {
            reject(new Error(`Invalid response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async healthCheck(url) {
    const old = this.baseUrl;
    this.baseUrl = url.replace(/\/+$/, "");
    try {
      const r = await this.request("GET", "/health");
      this.baseUrl = old;
      return r;
    } catch (e) {
      this.baseUrl = old;
      throw e;
    }
  }

  async login(url, username, password) {
    this.baseUrl = url.replace(/\/+$/, "");
    const r = await this.request("POST", "/auth/login", { username, password });
    this.token = r.token;
    this.user = r.user;
    this.connected = true;
    return r;
  }

  logout() {
    this.token = "";
    this.user = null;
    this.connected = false;
  }

  // Jobs
  async getJobs() { return this.request("GET", "/jobs"); }
  async createJob(data) { return this.request("POST", "/jobs", data); }
  async updateJob(id, updates) { return this.request("PUT", `/jobs/${encodeURIComponent(id)}`, updates); }
  async deleteJob(id) { return this.request("DELETE", `/jobs/${encodeURIComponent(id)}`); }

  // Customers
  async getCustomers() { return this.request("GET", "/customers"); }
  async createCustomer(data) { return this.request("POST", "/customers", data); }
  async updateCustomer(id, updates) { return this.request("PUT", `/customers/${encodeURIComponent(id)}`, updates); }
  async deleteCustomer(id) { return this.request("DELETE", `/customers/${encodeURIComponent(id)}`); }

  // Knowledge Base
  async getKb() { return this.request("GET", "/kb"); }
  async addKbEntry(category, data) { return this.request("POST", `/kb/${category}`, data); }
  async deleteKbEntry(category, id) { return this.request("DELETE", `/kb/${category}/${id}`); }

  // Vehicles
  async getVehicles() { return this.request("GET", "/vehicles"); }
  async createVehicle(data) { return this.request("POST", "/vehicles", data); }
  async deleteVehicle(id) { return this.request("DELETE", `/vehicles/${encodeURIComponent(id)}`); }

  // Users (admin)
  async getUsers() { return this.request("GET", "/users"); }
  async createUser(data) { return this.request("POST", "/users", data); }
  async updateUser(id, data) { return this.request("PUT", `/users/${id}`, data); }
  async deleteUser(id) { return this.request("DELETE", `/users/${id}`); }
  async changePassword(currentPassword, newPassword) {
    return this.request("POST", "/auth/change-password", { currentPassword, newPassword });
  }

  // Settings
  async getSettings() { return this.request("GET", "/settings"); }
  async updateSettings(data) { return this.request("PUT", "/settings", data); }

  // Invoice
  async getNextInvoiceNumber() { const r = await this.request("GET", "/invoice/next-number"); return r.number; }
  async incrementInvoiceNumber() { const r = await this.request("POST", "/invoice/increment-number"); return r.number; }
}

module.exports = { ServerClient };
