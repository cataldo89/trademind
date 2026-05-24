import agents.graph as g

def mock_rm(state):
    state['graham_passed'] = True
    state['graham_reason'] = 'Mocked passed'
    return state

def mock_ta(state):
    state['market_regime'] = 'Bull'
    state['ml_prediction'] = 0.05
    return state

def mock_risk(state):
    state['var_95'] = 0.02
    return state

# Apply mocks
g.research_manager = mock_rm
g.technical_analyst = mock_ta
g.risk_manager = mock_risk

res = g.run_analysis_workflow('AAPL')
print(res)
