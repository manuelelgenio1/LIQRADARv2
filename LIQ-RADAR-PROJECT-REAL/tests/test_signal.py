from backend.main import MarketState, market, signal


def test_signal_without_data_is_not_fabricated():
    market["BTCUSDT"] = MarketState(symbol="BTCUSDT")
    result = signal("BTCUSDT")
    assert result["direction"] == "INSUFFICIENT_DATA"
    assert result["score"] is None
    assert result["confidence"] == 0
