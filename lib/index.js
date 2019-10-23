const Controller = require('compool-controller');

let Service, Characteristic, Accessory, uuid;

class CompoolController {
    constructor(log, config, api) {
        log("Initializing CompoolController");
        this.log = log;
        this.config = config;
        this.name = this.config.name;
		this.lastStatus = null;
		this.pool = this.spa = this.air = null;
		this.auxs = {};

        if (!this.config.devicePath) {
            throw new Error(`A devicePath value is required for plugin ${this.name}`);
		}
		
		if (api) {
			this.api = api;
			this.api.on('didFinishLaunching', () => this.configureAll());
		}
	}

	configureAccessory(accessory) {
		if (accessory.context.pool) {
			this.pool = accessory;
		} else if (accessory.context.spa) {
			this.spa = accessory;
		} else if (accessory.context.air) {
			this.air = accessory;
		} else if (accessory.context.aux) {
			this.auxs[accessory.context.aux] = accessory;
		}
	}

    configureAll() {
        // let accessoryInfo = new Service.AccessoryInformation();
        // accessoryInfo
        //     .setCharacteristic(Characteristic.Manufacturer, "Compool")
        //     .setCharacteristic(Characteristic.Model, "cp3800")
        //     .setCharacteristic(Characteristic.Name, this.name);
		// this.accessories.push(accessoryInfo);

		if (!this.pool) {
			this.pool = new Accessory('Pool', uuid.generate('Pool'));
			this.pool.context.pool = true;
			this.pool.addService(Service.Thermostat, "Pool");
			this.api.registerPlatformAccessories('homebridge-compool', 'CompoolController', [this.pool]);
		}

		let poolTemp = this.pool.getService(Service.Thermostat);
		if (poolTemp) {
			poolTemp.getCharacteristic(Characteristic.TargetTemperature)
				.on('set', (value, cb) => this.controller.setPoolTemp(value, cb));
			poolTemp.getCharacteristic(Characteristic.TargetHeatingCoolingState)
				.setProps({ validValues: [0, 1], maxValue: 1 })
				.on('set', (value, cb) => this.controller.setPoolHeater(value, cb));
		}

		if (!this.spa) {
			this.spa = new Accessory('Spa', uuid.generate('Spa'));
			this.spa.context.spa = true;
			this.spa.addService(Service.Thermostat, "Spa");
			this.api.registerPlatformAccessories('homebridge-compool', 'CompoolController', [this.spa]);
		}

		let spaTemp = this.spa.getService(Service.Thermostat);
		if (spaTemp) {
			spaTemp.getCharacteristic(Characteristic.CurrentTemperature)
				.setProps({ 'maxValue': 40.5 });
			spaTemp.getCharacteristic(Characteristic.TargetTemperature)
				.setProps({ 'maxValue': 40.5 })
				.on('set', (value, cb) => this.controller.setSpaTemp(value, cb));
			spaTemp.getCharacteristic(Characteristic.TargetHeatingCoolingState)
				.setProps({ validValues: [0, 1], maxValue: 1 })
				.on('set', (value, cb) => this.controller.setSpaHeater(value, cb));
		}

		if (!this.air) {
			this.air = new Accessory('Air Temperature', uuid.generate('Air Temperature'));
			this.air.context.air = true;
			this.air.addService(Service.TemperatureSensor, "Air Temperature");
			this.api.registerPlatformAccessories('homebridge-compool', 'CompoolController', [this.air]);
		}

		let airTemp = this.air.getService(Service.TemperatureSensor);
		if (airTemp) {
			airTemp
				.getCharacteristic(Characteristic.CurrentTemperature)
				.on('get', cb => {
					cb(null, this.getStatus('airTemp'));
				});
		}

		for (let i = 1; i <= 8; ++i) {
			let name = this.config[`aux${i}`];
			let accessoryName = `aux${i}On`;
			if (name) {
				if (!this.auxs[accessoryName]) {
					let aux = new Accessory(name, uuid.generate(accessoryName));
					this.auxs[accessoryName] = aux;
					aux.addService(Service.Switch, name);
					this.api.registerPlatformAccessories('homebridge-compool', 'CompoolController', [aux]);
				}
				let aux = this.auxs[accessoryName];
				aux
					.getService(Service.Switch)
					.getCharacteristic(Characteristic.On)
					.on('get', cb => cb(null, this.getStatus(`aux${i}On`)) )
					.on('set', (value, cb) => this.controller.toggleAux(i, cb) );
			}
		}

        this.controller = new Controller(this.config.devicePath);
        this.controller.on('status', status => this.onStatus(status));
        this.controller.on('error', err => this.onControllerError(err));
    }

	refreshAll() {
		if (!this.lastStatus) return;
		let poolTemp = this.pool.getService(Service.Thermostat);
		poolTemp.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, this.getStatus('poolHeaterOn') ? 1 : 0);
		poolTemp.updateCharacteristic(Characteristic.TargetHeatingCoolingState, this.getStatus('poolHeaterOn') ? 1 : 0);
		poolTemp.updateCharacteristic(Characteristic.CurrentTemperature, this.getStatus('poolWaterTemp'));
		poolTemp.updateCharacteristic(Characteristic.TargetTemperature, this.getStatus('desiredPoolWaterTemp'));

		let spaTemp = this.spa.getService(Service.Thermostat);
		spaTemp.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, this.getStatus('spaHeaterOn') ? 1 : 0);
		spaTemp.updateCharacteristic(Characteristic.TargetHeatingCoolingState, this.getStatus('spaHeaterOn') ? 1 : 0);
		spaTemp.updateCharacteristic(Characteristic.CurrentTemperature, this.getStatus('spaWaterTemp'));
		spaTemp.updateCharacteristic(Characteristic.TargetTemperature, this.getStatus('desiredSpaWaterTemp'));

		let airTemp = this.air.getService(Service.TemperatureSensor);
		airTemp.updateCharacteristic(Characteristic.CurrentTemperature, this.getStatus('airTemp'));

		for (let field in this.auxs) {
			let value = this.getStatus(field);
			this.auxs[field]
				.getService(Service.Switch)
				.updateCharacteristic(Characteristic.On, value);
		}
	}

    getStatus(field) {
        if (!this.lastStatus) return null;
        return this.lastStatus[field];
    }

    onStatus(status) {
        this.lastStatus = status;
        this.log(status);
		this.refreshAll();
    }

    onControllerError(err) {
        this.log("Got error!", err);
    }
}

module.exports = homebridge => {
	Accessory = homebridge.platformAccessory;
	({ Service, Characteristic, uuid } = homebridge.hap);
	homebridge.registerPlatform('homebridge-compool', 'CompoolController', CompoolController, true);
};
