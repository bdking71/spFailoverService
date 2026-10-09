# SPFx Lucee Failover Module

This npm module provides high-availability failover capabilities for SharePoint Framework (SPFx) solutions communicating with multiple Lucee (ColdFusion) backend servers. It dynamically evaluates server responsiveness and datasource health states, automatically shifting traffic to the next available server if a database connection or server goes down.

## ⚠️ Requirements

This module **requires a Lucee webservice** deployed on each target backend server to function properly.
* The service expects a ColdFusion component (`DatasourceChecker.cfc`) available at the endpoint:
  `{ServerURL}{Path}DatasourceChecker.cfc?method=getStatus`
* The endpoint must return the status of the requested datasource (`DataSource`) so the utility can verify live operational availability[cite: 1].

## Installation

```bash
npm install spfx-lucee-failover