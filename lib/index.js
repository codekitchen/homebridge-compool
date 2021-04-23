const Controller = require('compool-controller');

let Service, Characteristic, Accessory, uuid, HeatState;

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

    createAccessory(name, configCB) {
        let acc = new Accessory(name, uuid.generate(name));
        acc.getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, "Compool")
            .setCharacteristic(Characteristic.Model, "cp3800");
        configCB(acc);
        this.api.registerPlatformAccessories('homebridge-compool', 'CompoolController', [acc]);
        return acc;
    }

    configureAux(auxAccessory, i) {
        auxAccessory
            .getCharacteristic(Characteristic.On)
            .on('get', cb => cb(null, this.getAuxStatus(i)))
            .on('set', (value, cb) => this.setAux(i, value).then(cb, cb));
    }

    configurePoolSpa(name, capName) {
        if (!this[name] && this.config[name]) {
            this[name] = this.createAccessory(capName, (acc) => {
                acc.context[name] = true;
                acc.addService(Service.Thermostat, capName);
            });
        }

        let acc = this[name];
        if (acc) {
            acc.context.pump = this.config[name].pump;
            for (const auxName in this.config[name].aux) {
                let aux = acc.getServiceByUUIDAndSubType(Service.Switch, auxName);
                if (!aux) {
                    aux = acc.addService(Service.Switch, auxName, auxName);
                }
                this.configureAux(aux, this.config[name].aux[auxName]);
            }
            let temp = acc.getService(Service.Thermostat);
            temp.getCharacteristic(Characteristic.CurrentTemperature)
                .on('get', cb => cb(null, this.getStatus(`${name}WaterTemp`)));
            temp.getCharacteristic(Characteristic.TargetTemperature)
                .on('get', cb => cb(null, this.getStatus(`desired${capName}WaterTemp`)))
                .on('set', (value, cb) => this.controller[`set${capName}Temp`](value).then(cb, cb));
            let stateProps = { validValues: [0, 1, 2], maxValue: 2 };
            if (name == 'spa') {
                stateProps = { validValues: [0, 1], maxValue: 1 };
            }
            temp.getCharacteristic(Characteristic.TargetHeatingCoolingState)
                .setProps(stateProps)
                .on('set', (value, cb) => {
                    this.setHeatingState(acc, value, `set${capName}Heater`)
                        .then(cb, cb);
                });
            if (name == 'spa') {
                temp.getCharacteristic(Characteristic.CurrentTemperature)
                    .setProps({ 'maxValue': 40.5 });
                temp.getCharacteristic(Characteristic.TargetTemperature)
                    .setProps({ 'maxValue': 40.5 });
            }
        }
    }

    configureAll() {
        const auxConfig = this.config.aux || {};
        for (const name in auxConfig) {
            const i = auxConfig[name];
            const accessoryName = `aux${i}On`;
            if (!this.auxs[accessoryName]) {
                this.auxs[accessoryName] = this.createAccessory(name, (aux) => {
                    aux.context.aux = accessoryName;
                    aux.addService(Service.Switch, name);
                });
            }
            this.configureAux(this.auxs[accessoryName].getService(Service.Switch), i);
        }

        this.configurePoolSpa('pool', 'Pool');
        this.configurePoolSpa('spa', 'Spa');

        if (!this.air) {
            this.air = this.createAccessory('Air Temperature', (air) => {
                air.context.air = true;
                air.addService(Service.TemperatureSensor, "Air Temperature");
            });
        }

        let airTemp = this.air.getService(Service.TemperatureSensor);
        if (airTemp) {
            airTemp
                .getCharacteristic(Characteristic.CurrentTemperature)
                .on('get', cb => {
                    cb(null, this.getStatus('airTemp'));
                });
        }

        this.controller = new Controller(this.config.devicePath);
        this.controller.on('status', status => this.onStatus(status));
        this.controller.on('error', err => this.onControllerError(err));
    }

    async setHeatingState(acc, value, setHeater) {
        let setPumpTo = false;
        let setHeaterTo = null;
        if (value == HeatState.HEAT) {
            setHeaterTo = true;
            setPumpTo = true;
        } else if (value == HeatState.COOL) {
            setHeaterTo = false;
            setPumpTo = true;
        }
        await this.setAux(acc.context.pump, setPumpTo);
        if (setHeaterTo !== null) {
            await this.controller[setHeater](setHeaterTo);
        }
    }

    refreshPoolSpa(name, capName) {
        let acc = this[name];
        let temp = acc.getService(Service.Thermostat);
        let currentState;
        if (!this.getAuxStatus(acc.context.pump)) {
            // pump is off
            currentState = HeatState.OFF;
        } else if (this.getStatus(`${name}HeaterOn`)) {
            currentState = HeatState.HEAT;
        } else {
            currentState = HeatState.COOL;
        }
        temp.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, currentState);
        let targetState = currentState;
        if (currentState != HeatState.OFF && this.getStatus(`${name}Delay`)) {
            targetState = HeatState.OFF;
        }
        temp.updateCharacteristic(Characteristic.TargetHeatingCoolingState, targetState);
        temp.updateCharacteristic(Characteristic.CurrentTemperature, this.getStatus(`${name}WaterTemp`));
        temp.updateCharacteristic(Characteristic.TargetTemperature, this.getStatus(`desired${capName}WaterTemp`));
        for (const auxName in this.config[name].aux) {
            acc.getServiceByUUIDAndSubType(Service.Switch, auxName)
                .updateCharacteristic(Characteristic.On, this.getAuxStatus(this.config[name].aux[auxName]));
        }
    }

    async refreshAll() {
        if (!this.lastStatus) return;

        this.refreshPoolSpa('pool', 'Pool');
        this.refreshPoolSpa('spa', 'Spa');

        let airTemp = this.air.getService(Service.TemperatureSensor);
        airTemp.updateCharacteristic(Characteristic.CurrentTemperature, this.getStatus('airTemp'));

        for (let field in this.auxs) {
            let value = this.getStatus(field);
            this.auxs[field]
                .getService(Service.Switch)
                .updateCharacteristic(Characteristic.On, value);
        }

        if (this.config.timezone) {
            const curTime = new Date(new Date().toLocaleString('en-US', { timeZone: this.config.timezone }));
            const skew = Math.abs(
                (curTime.getHours() * 60 + curTime.getMinutes()) -
                (this.getStatus('hour') * 60 + this.getStatus('minute')));
            if (skew > 3 && skew < (22 * 60)) { // avoid midnight gap
                this.log('got clock skew, setting time to ', curTime);
                await this.controller.setTime(curTime.getHours(), curTime.getMinutes());
            }
        }
    }

    getStatus(field) {
        if (!this.lastStatus) return null;
        return this.lastStatus[field];
    }

    getAuxStatus(idx) {
        return this.getStatus(`aux${idx}On`);
    }

    async setAux(idx, val) {
        if (this.getAuxStatus(idx) != val) {
            await this.controller.toggleAux(idx);
        }
    }

    onStatus(status) {
        this.lastStatus = status;
        this.refreshAll().catch((err) => this.onControllerError(err));
    }

    onControllerError(err) {
        this.log("Got error!", err);
    }
}

module.exports = homebridge => {
    Accessory = homebridge.platformAccessory;
    ({ Service, Characteristic, uuid } = homebridge.hap);
    HeatState = Characteristic.TargetHeatingCoolingState;
    homebridge.registerPlatform('homebridge-compool', 'CompoolController', CompoolController, true);
};
