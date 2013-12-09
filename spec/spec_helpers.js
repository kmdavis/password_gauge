var PLAIN_METRIC_THRESHOLDS = {
    "password_length": {
      "status": {
        "type": "linear",
        "thresholds": [8, 15, 32]
      },
      "score": {
        "type": "linear",
        "divisor": 64
      }
    },
    "num_uppercase": {
      "status": {
        "type": "percent",
        "min": 1,
        "thresholds": [0.1, 0.25]
      },
      "score": { "type": "percent" }
    },
    "num_lowercase": {
      "status": {
        "type": "percent",
        "min": 1,
        "thresholds": [0.1, 0.25]
      },
      "score": { "type": "percent" }
    },
    "num_numerals": {
      "status": {
        "type": "percent",
        "min": 1,
        "thresholds": [0.1, 0.25]
      },
      "score": { "type": "percent" }
    },
    "num_symbols": {
      "status": {
        "type": "percent",
        "min": 1,
        "thresholds": [0.1, 0.25]
      },
      "score": { "type": "percent" }
    },
    "num_classes": {
      "status": {
        "type": "choose",
        "values": ["danger", "danger", "warning", "info", "success"]
      },
      "score": {
        "type": "linear",
        "divisor": 4
      }
    },
    "num_words": {
      "status": {
        "type": "poison",
        "thresholds": [1, 2],
        "maxOfLength": 0.2
      },
      "score": {
        "type": "percent",
        "maxOfLength": 0.2
      }
    },
    "num_numbers": {
      "status": {
        "type": "poison",
        "thresholds": [1, 2],
        "maxOfLength": 0.2
      },
      "score": {
        "type": "percent",
        "maxOfLength": 0.2
      }
    },
    "num_years": {
      "status": {
        "type": "poison",
        "thresholds": [1, 2],
        "maxOfLength": 0.2
      },
      "score": {
        "type": "percent",
        "maxOfLength": 0.2
      }
    },
    "letters_only": {
      "status": {
        "type": "boolean",
        "invert": true
      },
      "score": {
        "type": "boolean",
        "invert": true
      }
    },
    "numerals_only": {
      "status": {
        "type": "boolean",
        "invert": true
      },
      "score": {
        "type": "boolean",
        "invert": true
      }
    },
    "symbols_only": {
      "status": {
        "type": "boolean",
        "invert": true
      },
      "score": {
        "type": "boolean",
        "invert": true
      }
    },
    "repeat_characters": {
      "status": {
        "type": "percent",
        "invert": true,
        "thresholds": [0.05, 0.1, 0.2]
      },
      "score": {
        "type": "percent"
      }
    },
    "repeat_characters_insensitive": {
      "status": {
        "type": "percent",
        "invert": true,
        "thresholds": [0.05, 0.1, 0.2]
      },
      "score": {
        "type": "percent"
      }
    },
    "repeat_numerals": {
      "status": {
        "type": "percent",
        "invert": true,
        "thresholds": [0.05, 0.1, 0.2]
      },
      "score": {
        "type": "percent"
      }
    },
    "repeat_symbols": {
      "status": {
        "type": "percent",
        "invert": true,
        "thresholds": [0.05, 0.1, 0.2]
      },
      "score": {
        "type": "percent"
      }
    },
    "sequential_characters": {
      "status": {
        "type": "percent",
        "invert": true,
        "thresholds": [0.01, 0.05, 0.1]
      },
      "score": {
        "type": "percent"
      }
    },
    "sequential_numerals": {
      "status": {
        "type": "percent",
        "invert": true,
        "thresholds": [0.01, 0.05, 0.1]
      },
      "score": {
        "type": "percent"
      }
    },
    "keyboard_proximity": {
      "status": {
        "type": "percent",
        "invert": true,
        "thresholds": [0.05, 0.1, 0.2]
      },
      "score": {
        "type": "percent"
      }
    },
    "dictionary_hit_count": {
      "status": {
        "type": "poison",
        "thresholds": [1, 2],
        "maxOfLength": 0.2
      },
      "score": {
        "type": "percent",
        "maxOfLength": 0.2
      }
    },
    "entropy": {
      "status": {
        "type": "linear",
        "thresholds": [64, 128, 256]
      },
      "score": {
        "type": "linear",
        "divisor": 400
      }
    }
  };
var PLAIN_NON_ENTROPIC_FACTOR_THRESHOLDS = {
  "num_words": {
    "minimumValue": 2,
    "divisorPercent": 0.2,
    "weight": 0.1
  },
  "num_numbers": {
    "minimumValue": 2,
    "divisorPercent": 0.2,
    "weight": 0.1
  },
  "num_years": {
    "minimumValue": 2,
    "divisorPercent": 0.2,
    "weight": 0.1
  },
  "repeat_characters": {
    "minimumPercent": 0.2,
    "divisorPercent": 1.0,
    "weight": 0.1
  },
  "repeat_characters_insensitive": {
    "minimumPercent": 0.2,
    "divisorPercent": 1.0,
    "weight": 0.1
  },
  "repeat_numerals": {
    "minimumPercent": 0.2,
    "divisorPercent": 1.0,
    "weight": 0.1
  },
  "repeat_symbols": {
    "minimumPercent": 0.2,
    "divisorPercent": 1.0,
    "weight": 0.1
  },
  "consecutive_uppercase": {
    "minimumPercent": 0.2,
    "divisorPercent": 1.0,
    "weight": 0.1
  },
  "consecutive_lowercase": {
    "minimumPercent": 0.2,
    "divisorPercent": 1.0,
    "weight": 0.1
  },
  "consecutive_numerals": {
    "minimumPercent": 0.2,
    "divisorPercent": 1.0,
    "weight": 0.1
  },
  "consecutive_symbols": {
    "minimumPercent": 0.2,
    "divisorPercent": 1.0,
    "weight": 0.1
  },
  "sequential_characters": {
    "minimumPercent": 0.2,
    "divisorPercent": 1.0,
    "weight": 0.1
  },
  "sequential_numerals": {
    "minimumPercent": 0.2,
    "divisorPercent": 1.0,
    "weight": 0.1
  },
  "keyboard_proximity": {
    "minimumPercent": 2.0,
    "divisorPercent": 1.0,
    "weight": 0.1
  },
  "dictionary_hit_count": {
    "minimumValue": 1,
    "divisorPercent": 0.2,
    "weight": 0.1
  }
};
var PLAIN_DICTIONARY = ['testing', 'password', 'dictionary'];
var QWERTY_KEYBOARD_MAP = [
  [
    ["`", "~"], ["1", "!"], ["2", "@"], ["3", "#"], ["4", "$"], ["5", "%"], ["6", "^"], ["7", "&"], ["8", "*"], ["9", "("], ["0", ")"], ["-", "_"], ["=", "+"]
  ],
  [
    null, ["q", "Q"], ["w", "W"], ["e", "E"], ["r", "R"], ["t", "T"], ["y", "Y"], ["u", "U"], ["i", "I"], ["o", "O"], ["p", "P"], ["[", "{"], ["]", "}"], ["\\", "|"]
  ],
  [
    null, ["a", "A"], ["s", "S"], ["d", "D"], ["f", "F"], ["g", "G"], ["h", "H"], ["j", "J"], ["k", "K"], ["l", "L"], [";", ":"], ["'", "\""]
  ],
  [
    null, ["z", "Z"], ["x", "X"], ["c", "C"], ["v", "V"], ["b", "B"], ["n", "N"], ["m", "M"], [",", "<"], [".", ">"], ["/", "?"]
  ]
];

// Make sure that everything is init'd.
Analyzer.init({
  keyboard: new Keyboard(QWERTY_KEYBOARD_MAP),
  dictionary: new Dictionary(PLAIN_DICTIONARY)
});
// These 2 will likely be re-init'ed in the actual specs (possibly many times)
// These init's are for "just in case", so shiz don't break!
NonEntropicFactors.init({ nonEntropicFactorThresholds: PLAIN_NON_ENTROPIC_FACTOR_THRESHOLDS });
MetricScorer.init({ metricThresholds: PLAIN_METRIC_THRESHOLDS });