# Metric read lifetime
Public MetricReadOperation bounds trusted service work by caller deadline and
configured ceiling (default 30 s history; live 5 s). Abort returns an explicit failure;
caller service retains the original through settlement. No queue or I/O itself.
check fences late callbacks; dispose clears the sole original timer.
Tests are owned by historical/live metric services; no duplicate lifecycle owner.
