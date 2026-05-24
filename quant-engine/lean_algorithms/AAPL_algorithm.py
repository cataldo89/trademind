
from AlgorithmImports import *

class TradeMindExportedAlgorithm(QCAlgorithm):
    def Initialize(self):
        self.SetStartDate(2023, 1, 1)
        self.SetCash(100000)
        self.AddEquity("AAPL", Resolution.DAILY)
        
        self.rsi_period = 14
        self.var_threshold = 0.05

    def OnData(self, data):
        if not self.Portfolio.Invested:
            self.SetHoldings("AAPL", 1)
